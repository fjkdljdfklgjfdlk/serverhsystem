#!/usr/bin/env python3
"""Local Roblox friends Chat announcer. Python 3.10+, no dependencies."""

import getpass
import hashlib
import json
import os
from pathlib import Path
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import warnings


CHAT = "https://apis.roblox.com/platform-chat-api/v1/"
USERS = "https://users.roblox.com/v1/users/authenticated"
FRIENDS = "https://friends.roblox.com/v1/users/{}/friends"
def application_directory():
    if getattr(sys, "frozen", False):
        if sys.platform == "darwin":
            return Path.home() / "ServerHSystem"
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


STATE = application_directory() / "delivery-history.json"
ENV_FILE = application_directory() / ".env"
DELAY = 10  # Local pacing only; Roblox can still rate limit requests.


class StopBatch(Exception):
    """Stop rather than retry a possibly delivered message."""


class RecipientError(Exception):
    """A single recipient or conversation was rejected."""


def load_cookie(path=ENV_FILE):
    """Read ROBLOX_COOKIE literally, without evaluating or interpolating secrets."""
    value = os.environ.get("ROBLOX_COOKIE", "").strip()
    if value:
        return value
    try:
        content = path.read_text(encoding="utf-8-sig")
    except FileNotFoundError:
        return ""
    except (OSError, UnicodeError):
        raise ValueError("Cannot read .env beside announcer.py.") from None
    value = ""
    for line in content.splitlines():
        line = line.strip()
        if line.startswith("export "):
            line = line[7:].lstrip()
        key, separator, candidate = line.partition("=")
        if not separator or key.strip() != "ROBLOX_COOKIE":
            continue
        candidate = candidate.strip()
        if candidate.startswith(("'", '\"')):
            quote = candidate[0]
            end = candidate.find(quote, 1)
            if end < 0 or (candidate[end + 1:].strip()
                           and not candidate[end + 1:].strip().startswith("#")):
                raise ValueError("Invalid ROBLOX_COOKIE quoting in .env.")
            value = candidate[1:end]
        else:
            value = candidate.split(" #", 1)[0].strip()
    return value


def get_cookie():
    cookie = load_cookie()
    if cookie:
        return cookie
    # Refuse getpass's echoing fallback when hidden input is unavailable.
    with warnings.catch_warnings():
        warnings.simplefilter("error", getpass.GetPassWarning)
        return getpass.getpass("Cookie value (hidden, memory only): ")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Roblox:
    def __init__(self, cookie):
        cookie = cookie.strip()
        if not cookie or any(c in cookie for c in "\r\n;\"\t "):
            raise ValueError("Paste only the cookie value, not a Cookie header.")
        self.cookie = cookie
        self.csrf = ""
        handlers = [urllib.request.ProxyHandler({}), NoRedirect()]
        if getattr(sys, "frozen", False):
            ca_file = Path(sys._MEIPASS) / "cacert.pem"
            handlers.append(urllib.request.HTTPSHandler(context=ssl.create_default_context(cafile=ca_file)))
        self.opener = urllib.request.build_opener(*handlers)

    def request(self, method, url, payload=None):
        parsed = urllib.parse.urlsplit(url)
        if parsed.scheme != "https" or parsed.netloc not in {
            "users.roblox.com", "friends.roblox.com", "apis.roblox.com"
        }:
            raise StopBatch("Refusing an unexpected destination.")
        body = None if payload is None else json.dumps(payload).encode("utf-8")
        for attempt in range(2):
            headers = {
                "Cookie": ".ROBLOSECURITY=" + self.cookie,
                "Accept": "application/json",
                "Content-Type": "application/json",
                "User-Agent": "LocalRobloxAnnouncer/1.0",
                "Origin": "https://www.roblox.com",
                "Referer": "https://www.roblox.com/",
            }
            if self.csrf:
                headers["X-CSRF-TOKEN"] = self.csrf
            req = urllib.request.Request(url, data=body, headers=headers, method=method)
            try:
                with self.opener.open(req, timeout=30) as response:
                    raw = response.read()
                data = json.loads(raw)
                if not isinstance(data, dict):
                    raise StopBatch("Unexpected Roblox response; delivery may be unknown.")
                return data
            except urllib.error.HTTPError as exc:
                # Only retry an explicit CSRF rejection, never a timeout or 5xx.
                if exc.headers.get("rblx-challenge-id") or exc.headers.get("rblx-challenge-type"):
                    exc.close()
                    raise StopBatch("Roblox requires an account challenge. Open Roblox normally.") from None
                token = exc.headers.get("x-csrf-token")
                if exc.code == 403 and token and method == "POST" and attempt == 0:
                    self.csrf = token
                    exc.close()
                    continue
                code = exc.code
                exc.close()
                if code == 401:
                    raise StopBatch("Session rejected or expired. Sign in again locally.") from None
                if code == 403:
                    raise StopBatch("Roblox blocked this action. Check account/chat eligibility.") from None
                if code == 429:
                    raise StopBatch("Rate limited (429). Batch stopped; do not immediately retry.") from None
                if code in (400, 404, 409, 422):
                    raise RecipientError(f"Roblox rejected the request (HTTP {code}).") from None
                raise StopBatch(f"Roblox returned HTTP {code}; delivery may be unknown.") from None
            except (urllib.error.URLError, TimeoutError, OSError, ValueError):
                raise StopBatch("Network/response error. Delivery may be unknown; no automatic retry.") from None

    def me(self):
        data = self.request("GET", USERS)
        if not isinstance(data.get("id"), int) or not data.get("name"):
            raise StopBatch("Account response format changed.")
        return data

    def friends(self, user_id):
        # This endpoint returns the full friend list, without pagination.
        data = self.request("GET", FRIENDS.format(user_id))
        rows = data.get("data")
        if not isinstance(rows, list) or any(
            not isinstance(row, dict) or not isinstance(row.get("id"), int)
            for row in rows
        ):
            raise StopBatch("Friend-list response format changed.")
        return sorted({row["id"]: row for row in rows}.values(),
                      key=lambda row: str(row.get("name", row["id"])).lower())

    def direct_conversation(self, sender_id, friend_id):
        # Platform Chat is a website API, with no stable Open Cloud contract.
        # Request a direct conversation and validate its membership before sending.
        data = self.request("POST", CHAT + "create-conversations", {
            "conversations": [{"type": "one_to_one", "participant_user_ids": [friend_id]}],
            "include_user_data": False,
        })
        rows = data.get("conversations", [])
        if not isinstance(rows, list) or len(rows) != 1 or not isinstance(rows[0], dict):
            raise StopBatch("Unexpected conversation response. Website API may have changed.")
        conv = rows[0]
        if conv.get("status") != "success":
            raise RecipientError("Roblox did not accept the direct conversation.")
        participants = conv.get("participant_user_ids")
        if not isinstance(participants, list) or any(
            not isinstance(uid, (str, int)) for uid in participants
        ):
            raise StopBatch("Cannot verify conversation recipients; nothing sent.")
        if {str(uid) for uid in participants} != {str(sender_id), str(friend_id)}:
            raise StopBatch("Conversation membership differs from the intended recipient.")
        if conv.get("type") != "one_to_one" or not conv.get("id"):
            raise StopBatch("Direct conversation format changed; nothing sent.")
        return str(conv["id"])

    def send(self, conversation_id, message):
        data = self.request("POST", CHAT + "send-messages", {
            "conversation_id": conversation_id,
            "messages": [{"content": message}],
        })
        rows = data.get("messages", [])
        if (not isinstance(rows, list) or len(rows) != 1
                or not isinstance(rows[0], dict)
                or rows[0].get("status") != "success" or not rows[0].get("id")):
            raise StopBatch("No unambiguous send acknowledgement; delivery is unknown.")
        return str(rows[0]["id"])


class History:
    def __init__(self, path=STATE):
        self.path = path
        try:
            self.data = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(self.data, dict) or any(
                not isinstance(value, dict) or value.get("status") not in {"sent", "unknown", "rejected"}
                for value in self.data.values()
            ):
                raise ValueError
        except FileNotFoundError:
            self.data = {}
        except (ValueError, OSError):
            raise StopBatch("Cannot read delivery-history.json. Inspect it before sending again.") from None

    @staticmethod
    def key(sender_id, friend_id, message):
        value = json.dumps([sender_id, friend_id, message], ensure_ascii=False)
        return hashlib.sha256(value.encode("utf-8")).hexdigest()

    def status(self, key):
        return self.data.get(key, {}).get("status")

    def record(self, key, friend_id, status, message_id=None):
        self.data[key] = {"friend_id": friend_id, "status": status,
                          "time": time.time(), "message_id": message_id}
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temp = self.path.with_suffix(".tmp")
        fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(self.data, handle, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp, self.path)


def label(friend):
    # Escape control characters in names returned by the network.
    name = str(friend.get("name", friend["id"]))
    return f"{ascii(name)[1:-1]} ({friend['id']})"


def read_message():
    print("Enter your announcement. A line containing only . finishes it.")
    lines = []
    while True:
        line = input()
        if line == ".":
            break
        lines.append(line)
    message = "\n".join(lines).strip()
    if not message or len(message) > 1000:
        raise ValueError("Use 1–1000 characters (this menu's local limit).")
    if "WARNING:-DO-NOT-SHARE" in message or ".ROBLOSECURITY" in message:
        raise ValueError("The announcement appears to contain a session secret.")
    return message


def preview(sender, friends, message, history):
    print(f"\nFrom: {label(sender)}\nAnnouncement:\n{message!r}\n")
    pending = []
    for friend in friends:
        key = history.key(sender["id"], friend["id"], message)
        status = history.status(key)
        if status:
            print(f"SKIP {label(friend)}: previous status {status}")
        else:
            pending.append(friend)
            print("TO   " + label(friend))
    print(f"\n{len(pending)} recipients to attempt. Chat restrictions still apply.")
    return pending


def deliver(client, sender, friends, message, history):
    pending = preview(sender, friends, message, history)
    if not pending:
        return
    expected = f"SEND {len(pending)}"
    if input(f"Type {expected} to send, or Enter to cancel: ").strip() != expected:
        print("Cancelled.")
        return
    for index, friend in enumerate(pending):
        if index:
            time.sleep(DELAY)
        key = history.key(sender["id"], friend["id"], message)
        try:
            conv_id = client.direct_conversation(sender["id"], friend["id"])
        except RecipientError as exc:
            print(f"SKIP {label(friend)}: {exc}")
            continue
        # Persist before the send. Interruptions or timeouts then block duplicates.
        history.record(key, friend["id"], "unknown")
        try:
            message_id = client.send(conv_id, message)
        except RecipientError as exc:
            history.record(key, friend["id"], "rejected")
            print(f"REJECTED {label(friend)}: {exc}")
            continue
        history.record(key, friend["id"], "sent", message_id)
        print(f"ACCEPTED {label(friend)} [{message_id}]")
    print("Batch finished. ACCEPTED means the API acknowledged it, not that it was read.")


def main():
    print("Roblox friends Chat announcements — local terminal menu")
    print("Cookie: ROBLOX_COOKIE environment variable, then .env, then hidden prompt.")
    print("Website Chat API compatibility is experimental; Inbox messaging is retired.")
    client = sender = None
    friends = []
    message = ""
    history = History()
    try:
        while True:
            print("\n1. Connect / change account\n2. Load and list friends"
                  "\n3. Write announcement\n4. Preview (no sending)"
                  "\n5. Send test to one friend\n6. Send to all loaded friends\n0. Exit")
            try:
                choice = input("> ").strip()
                if choice == "0":
                    return
                if choice == "1":
                    client = sender = None
                    friends = []
                    cookie = get_cookie()
                    candidate = Roblox(cookie)
                    del cookie
                    account = candidate.me()
                    client, sender = candidate, account
                    print("Connected as " + label(sender))
                elif choice == "3":
                    message = read_message()
                    print("Announcement ready.")
                elif choice in {"2", "4", "5", "6"}:
                    if not client or not sender:
                        raise ValueError("Connect with option 1 first.")
                    if choice == "2":
                        friends = []
                        friends = client.friends(sender["id"])
                        for friend in friends:
                            print(label(friend))
                        print(f"Loaded {len(friends)} friends.")
                        continue
                    if not friends or not message:
                        raise ValueError("Load friends and write an announcement first.")
                    if choice == "4":
                        preview(sender, friends, message, history)
                    elif choice == "5":
                        friend_id = int(input("Friend's user ID from the list: ").strip())
                        selected = [f for f in friends if f["id"] == friend_id]
                        if not selected:
                            raise ValueError("That ID is not in the loaded friend list.")
                        deliver(client, sender, selected, message, history)
                    else:
                        deliver(client, sender, friends, message, history)
                else:
                    print("Choose a listed option.")
            except getpass.GetPassWarning:
                print("Hidden input unavailable. Run this file in a real terminal.")
            except (ValueError, RecipientError) as exc:
                print(str(exc))
            except StopBatch as exc:
                print("STOPPED: " + str(exc))
            except OSError:
                print("STOPPED: history could not be saved. Check it before sending again.")
    finally:
        if client:
            client.cookie = ""
            client.csrf = ""


if __name__ == "__main__":
    if "--cli" not in sys.argv:
        from panel import launch
        launch()
        sys.exit(0)
    try:
        main()
    except (EOFError, KeyboardInterrupt):
        print("\nExited. Interrupted sends remain marked unknown.")
    except StopBatch as exc:
        print("STOPPED: " + str(exc))
        sys.exit(1)
