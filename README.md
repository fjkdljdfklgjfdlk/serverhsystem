# Roblox Python announcement panel

## Packaged applications

- **macOS (Apple Silicon):** Open `ServerHSystem.app`, already installed in `~/ServerHSystem`, or use `ServerHSystem-macOS-arm64.dmg` to copy the app elsewhere. Python and Tk are included. The packaged Mac app always reads `.env` and saves `delivery-history.json` in `~/ServerHSystem`, including when launched from Applications.
- **Windows (64-bit):** Open `ServerHSystem.exe`. Python and Tk are included. Keep `.env` beside the EXE; delivery history is saved there too. Use a folder where your Windows account can write files. Copy `.env.example` to `.env` and fill it in locally if moving to another computer.

Your actual cookie is kept outside both binaries and the disk image. The existing `.env` in `~/ServerHSystem` was preserved. Existing delivery history was migrated from the source folder when the destination did not already have a history file. Continue using one copy of the app at a time.

The Mac app is locally ad-hoc signed, without Apple notarization. The Windows EXE is unsigned and **has not been runtime-tested on Windows**. It was assembled with the official Windows CPython 3.14.6 runtime, the matching official Tcl/Tk files, and PyInstaller's prebuilt x64 GUI bootloader. Its PE architecture, GUI subsystem, checksum, Python bytecode version and all 972 archive entries were verified. The Mac app passed a packaged launch test with both interface languages, the output log, and bundled HTTPS certificates. The DMG passed `hdiutil verify`. Source validation has 23 passing offline tests. Chat delivery remains experimental and unverified.

## Running from Python source

Run with **Python 3.10 or later with Tkinter**. The app uses default native Tk/ttk controls, without a custom theme. No pip packages are required:

```sh
python3 announcer.py
```

This opens the desktop panel. On Windows, `py announcer.py` also works, or double-click `start_panel.pyw` when Python file associations are installed. Keep `panel.py` and `announcer.py` together. The former terminal version remains available with `python3 announcer.py --cli`.

1. Revoke the exposed Roblox session in **Settings → Security → Where you're logged in**. Log out that session, then sign in again. Never reuse a cookie posted in a chat.
2. Put a fresh cookie in `.env` beside `announcer.py` (copy `.env.example` to `.env` if needed), then click **Connect / reload .env**. The panel reads it again each time you connect. It does not read browser cookies or send the cookie anywhere except the three Roblox API hosts used in the source.
3. Click **English** or **Bahasa Indonesia** at the top. These buttons switch the panel labels and new output log entries. Announcements are sent exactly as typed; service error details retain their original text.
4. Click **Load friends**, then write your message in the **Announcement** box.
5. Click **Preview** to review recipients and the exact message in the **Output** box. Preview sends no messages.
6. Select a friend in the list and click **Send to selected friend** for a test. Check the result on Roblox before attempting a batch.
7. Click **Send to all friends**, review the preview and confirm the dialog to attempt the batch. **Stop** interrupts the waiting period or stops after the current request finishes. Network requests use a 30-second timeout per attempt; a CSRF refresh can require a second attempt.

The panel stays responsive while network operations run. Its output box includes recipient details, API acknowledgements, errors, skipped duplicates, cancellation and result counts. The progress bar counts attempted recipients. Only one operation runs at a time, and the message is locked during an operation.

## Cookie configuration

Edit `.env` locally:

```dotenv
ROBLOX_COOKIE="paste_your_fresh_cookie_value_here"
```

Use only the cookie value. Source runs locate `.env` relative to the script; packaged apps use the locations described above. An existing nonempty `ROBLOX_COOKIE` process environment variable takes precedence over `.env`. If neither supplies a value, the panel opens a masked cookie dialog (the CLI uses a hidden terminal prompt). Values are read literally; shell commands and variable references are never evaluated. Single quotes, double quotes, blank lines, and comments are supported.

`.env` stores the cookie as plaintext. Keep it private; `.gitignore` excludes it. The distributed ZIP includes `.env.example` and never packages your actual `.env`. On macOS/Linux, `chmod 600 .env` restricts file access to your user. The program does not print or write the cookie.

## Compatibility and delivery limits

This is an **experimental website Chat API client**, not a Roblox-supported Open Cloud DM integration. Roblox retired user-to-user **Inbox** messaging on October 29, 2024. This menu attempts ordinary one-to-one **Chat** messages from your account; it cannot create official Roblox system announcements.

The website's platform Chat service was identified from Roblox's current public JavaScript configuration. Its request/response contract is not a stable public Open Cloud API. The adapter currently requests `one_to_one` conversations through `create-conversations` and posts through `send-messages`. **Authenticated conversation creation and delivery have not been verified.** If Roblox rejects that conversation type or changes the schema, the menu reports the rejection and sends nothing to that recipient. HTTP success alone is never counted as delivery: the menu requires a message ID and a `success` acknowledgement. All actual chat permission, age, filtering, regional and privacy restrictions remain enforced by Roblox. Delivery to every friend cannot be guaranteed.

The script validates both participants before sending. It attempts one message per friend, waits 10 seconds between recipients, stops on account challenges/403s/429s, and does not bypass restrictions. Pacing does not guarantee that Roblox will accept automation or avoid account restrictions. API errors are summarized without dumping credential-bearing requests or raw responses.

`delivery-history.json` is created beside the script. It contains recipient IDs, timestamps, status and acknowledgement IDs, plus a hash derived from the sender/recipient/message. It contains neither the cookie nor plaintext announcement text. Protect it as account activity data. A prior `sent`, `unknown` or `rejected` entry suppresses repeating the exact same message to the same friend, including after restarting. A test send is therefore skipped in the following full batch. Changes to whitespace count as a different message.

If a send times out, gets interrupted or returns an unclear response, its status stays `unknown`. Check the conversation on Roblox before considering another attempt. Do not delete history to retry an unknown send blindly. Creating a conversation can itself be an account-side action even when the message is subsequently rejected.

Only run one copy of the app at a time; the history file is not a multi-process database. Keep the history file with the script when moving it. There is no background scheduler or automatic repeat sending.

## Sources

- [Roblox: Inbox messaging retirement](https://devforum.roblox.com/t/sunsetting-user-to-user-inbox-messaging/3187502)
- [Roblox: session management](https://en.help.roblox.com/hc/en-us/articles/14482664311060-Session-Management)
- [Roblox: current chat eligibility](https://about.roblox.com/safety-faqs)
- [Roblox: friends API](https://friends.roblox.com/docs/json/v1)
- [Roblox: authenticated user API](https://users.roblox.com/docs/json/v1)

Validation: 23 offline tests passed, including packaged data paths, language switching, preview without sending, .env loading, selected-recipient sending, duplicate prevention, cancellation, timeout history, and responsive worker completion. The native panel was also launched and visually inspected. No cookie from the conversation was used and no live messages were sent.
