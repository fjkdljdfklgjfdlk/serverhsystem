"""Default Tk desktop panel for the local announcement client."""

import queue
import threading
import tkinter as tk
from tkinter import messagebox, simpledialog, ttk
from tkinter.scrolledtext import ScrolledText

from announcer import DELAY, History, RecipientError, Roblox, StopBatch, label, load_cookie


TEXT = {
    "en": {
        "title": "Roblox Announcement Panel", "language": "Language",
        "account": "Account", "connect": "Connect / reload .env", "friends": "Friends",
        "load": "Load friends", "username": "Username", "user_id": "User ID",
        "message": "Announcement", "limit": "1–1000 characters. Select a friend for a test send.",
        "preview": "Preview", "test": "Send to selected friend", "all": "Send to all friends",
        "stop": "Stop", "output": "Output", "clear": "Clear output", "ready": "Ready",
        "disconnected": "Not connected", "busy": "Working…", "connecting": "Connecting…",
        "loading": "Loading friends…", "sending": "Sending…", "error": "Error",
        "experimental": "Chat API compatibility is experimental. Live delivery is unverified.",
        "cookie_title": "Cookie", "cookie_prompt": "No cookie in .env. Enter a fresh cookie (hidden):",
        "cancelled": "Cancelled.", "connected": "Connected as {account}",
        "loaded": "Loaded {count} friends.", "need_account": "Connect your account first.",
        "need_friends": "Load your friends first.", "select": "Select a friend from the list first.",
        "invalid_message": "Enter an announcement of 1–1000 characters.",
        "secret": "The announcement appears to contain a session secret.",
        "from": "From: {account}", "announcement": "Announcement:",
        "recipient": "TO: {friend}", "skip": "SKIP {friend}: previous status {status}",
        "summary": "{count} recipients to attempt.", "none": "No new recipients for this message.",
        "confirm_title": "Confirm announcement", "confirm": "Send this announcement to {count} friend(s)?\n\n{message}",
        "stopping": "Stopping after the current request finishes.",
        "stopped": "Stopped. No further recipients will be attempted.",
        "rejected": "REJECTED {friend}: {reason}", "accepted": "ACCEPTED {friend} [{message_id}]",
        "finished": "Results: {accepted} accepted, {rejected} rejected, {unknown} unknown, {remaining} not attempted.",
        "ack": "ACCEPTED means Roblox acknowledged the message; it does not mean it was read.",
        "failed": "STOPPED: {reason}", "storage_error": "Could not save history. Inspect it before retrying.",
        "unexpected": "Unexpected error. Sending stopped; check Roblox before retrying.",
        "details": "Service details: {reason}",
        "close_title": "Close panel?", "close_busy": "A request may still be in progress. Close now?\nInterrupted sends may remain marked unknown.",
    },
    "id": {
        "title": "Panel Pengumuman Roblox", "language": "Bahasa",
        "account": "Akun", "connect": "Hubungkan / muat ulang .env", "friends": "Teman",
        "load": "Muat teman", "username": "Nama pengguna", "user_id": "ID pengguna",
        "message": "Pengumuman", "limit": "1–1000 karakter. Pilih teman untuk mengirim pesan uji.",
        "preview": "Pratinjau", "test": "Kirim ke teman terpilih", "all": "Kirim ke semua teman",
        "stop": "Hentikan", "output": "Keluaran", "clear": "Bersihkan keluaran", "ready": "Siap",
        "disconnected": "Belum terhubung", "busy": "Sedang bekerja…", "connecting": "Menghubungkan…",
        "loading": "Memuat teman…", "sending": "Mengirim…", "error": "Kesalahan",
        "experimental": "Kompatibilitas API Chat masih eksperimental. Pengiriman langsung belum diverifikasi.",
        "cookie_title": "Cookie", "cookie_prompt": "Cookie tidak ada di .env. Masukkan cookie baru (tersembunyi):",
        "cancelled": "Dibatalkan.", "connected": "Terhubung sebagai {account}",
        "loaded": "{count} teman dimuat.", "need_account": "Hubungkan akun terlebih dahulu.",
        "need_friends": "Muat daftar teman terlebih dahulu.", "select": "Pilih teman dari daftar terlebih dahulu.",
        "invalid_message": "Masukkan pengumuman sepanjang 1–1000 karakter.",
        "secret": "Pengumuman tampaknya berisi rahasia sesi.",
        "from": "Dari: {account}", "announcement": "Pengumuman:",
        "recipient": "KE: {friend}", "skip": "LEWATI {friend}: status sebelumnya {status}",
        "summary": "{count} penerima akan dicoba.", "none": "Tidak ada penerima baru untuk pesan ini.",
        "confirm_title": "Konfirmasi pengumuman", "confirm": "Kirim pengumuman ini ke {count} teman?\n\n{message}",
        "stopping": "Menghentikan setelah permintaan saat ini selesai.",
        "stopped": "Dihentikan. Tidak ada penerima berikutnya yang akan dicoba.",
        "rejected": "DITOLAK {friend}: {reason}", "accepted": "DITERIMA {friend} [{message_id}]",
        "finished": "Hasil: {accepted} diterima, {rejected} ditolak, {unknown} tidak diketahui, {remaining} belum dicoba.",
        "ack": "DITERIMA berarti Roblox menerima pesan, bukan berarti pesan telah dibaca.",
        "failed": "DIHENTIKAN: {reason}", "storage_error": "Riwayat tidak dapat disimpan. Periksa sebelum mencoba lagi.",
        "unexpected": "Kesalahan tak terduga. Pengiriman dihentikan; periksa Roblox sebelum mencoba lagi.",
        "details": "Detail layanan: {reason}",
        "close_title": "Tutup panel?", "close_busy": "Permintaan mungkin masih berlangsung. Tutup sekarang?\nPesan yang terputus dapat tetap berstatus tidak diketahui.",
    },
}


class Panel:
    def __init__(self, root, history=None):
        self.root = root
        self.lang = "en"
        self.client = self.sender = None
        self.friends = []
        self.history = history
        self.busy = False
        self.events = queue.Queue()
        self.cancel = threading.Event()
        self.translated = []
        self.status_key = "ready"
        root.geometry("860x800")
        root.minsize(760, 700)
        root.protocol("WM_DELETE_WINDOW", self.close)
        root.columnconfigure(0, weight=1)
        root.rowconfigure(0, weight=1)
        outer = ttk.Frame(root, padding=10)
        outer.grid(sticky="nsew")
        outer.columnconfigure(0, weight=1)
        outer.rowconfigure(3, weight=1)
        outer.rowconfigure(7, weight=1)

        languages = ttk.Frame(outer)
        languages.grid(row=0, sticky="ew", pady=(0, 8))
        self.widget(ttk.Label(languages), "language").pack(side="left", padx=(0, 10))
        self.en_button = ttk.Button(languages, text="English", command=lambda: self.set_language("en"))
        self.en_button.pack(side="left", padx=3)
        self.id_button = ttk.Button(languages, text="Bahasa Indonesia", command=lambda: self.set_language("id"))
        self.id_button.pack(side="left", padx=3)

        account = self.widget(ttk.LabelFrame(outer, padding=8), "account")
        account.grid(row=1, sticky="ew", pady=(0, 8))
        self.connect_button = self.widget(ttk.Button(account, command=self.connect), "connect")
        self.connect_button.pack(side="left")
        self.load_button = self.widget(ttk.Button(account, command=self.load_friends), "load")
        self.load_button.pack(side="left", padx=8)
        self.account_label = ttk.Label(account)
        self.account_label.pack(side="left", padx=8)

        self.widget(ttk.Label(outer), "experimental").grid(row=2, sticky="w", pady=(0, 8))
        friends_box = self.widget(ttk.LabelFrame(outer, padding=6), "friends")
        friends_box.grid(row=3, sticky="nsew", pady=(0, 8))
        friends_box.columnconfigure(0, weight=1)
        friends_box.rowconfigure(0, weight=1)
        self.tree = ttk.Treeview(friends_box, columns=("name", "id"), show="headings", selectmode="browse", height=5)
        self.tree.column("name", width=420)
        self.tree.column("id", width=200)
        self.tree.grid(row=0, column=0, sticky="nsew")
        friend_scroll = ttk.Scrollbar(friends_box, orient="vertical", command=self.tree.yview)
        friend_scroll.grid(row=0, column=1, sticky="ns")
        self.tree.configure(yscrollcommand=friend_scroll.set)

        message_box = self.widget(ttk.LabelFrame(outer, padding=6), "message")
        message_box.grid(row=4, sticky="ew", pady=(0, 8))
        self.message = ScrolledText(message_box, height=5, wrap="word", undo=True)
        self.message.pack(fill="x")
        self.widget(ttk.Label(message_box), "limit").pack(anchor="w", pady=(4, 0))

        actions = ttk.Frame(outer)
        actions.grid(row=5, sticky="ew", pady=(0, 8))
        self.preview_button = self.widget(ttk.Button(actions, command=self.preview), "preview")
        self.test_button = self.widget(ttk.Button(actions, command=lambda: self.send(selected=True)), "test")
        self.send_button = self.widget(ttk.Button(actions, command=self.send), "all")
        self.stop_button = self.widget(ttk.Button(actions, command=self.stop), "stop")
        for button in (self.preview_button, self.test_button, self.send_button, self.stop_button):
            button.pack(side="left", padx=(0, 6))

        self.progress = ttk.Progressbar(outer, mode="determinate")
        self.progress.grid(row=6, sticky="ew", pady=(0, 8))
        output_box = self.widget(ttk.LabelFrame(outer, padding=6), "output")
        output_box.grid(row=7, sticky="nsew")
        self.output = ScrolledText(output_box, height=10, wrap="word", state="disabled")
        self.output.pack(fill="both", expand=True)
        self.widget(ttk.Button(output_box, command=self.clear_output), "clear").pack(anchor="e", pady=(5, 0))
        self.status_label = ttk.Label(outer)
        self.status_label.grid(row=8, sticky="w", pady=(6, 0))
        self.set_language("en")
        self.log("ready")
        root.after(80, self.drain)

    def t(self, key, **values):
        return TEXT[self.lang][key].format(**values)

    def widget(self, widget, key):
        self.translated.append((widget, key))
        return widget

    def set_language(self, language):
        self.lang = language
        self.root.title(self.t("title"))
        for widget, key in self.translated:
            widget.configure(text=self.t(key))
        self.tree.heading("name", text=self.t("username"))
        self.tree.heading("id", text=self.t("user_id"))
        self.account_label.configure(text=label(self.sender) if self.sender else self.t("disconnected"))
        self.status_label.configure(text=self.t(self.status_key))
        self.en_button.state(["pressed"] if language == "en" else ["!pressed"])
        self.id_button.state(["pressed"] if language == "id" else ["!pressed"])
        self.update_buttons()

    def update_buttons(self):
        for button in (self.connect_button, self.load_button, self.preview_button, self.test_button, self.send_button):
            button.state(["disabled"] if self.busy else ["!disabled"])
        self.stop_button.state(["!disabled"] if self.busy else ["disabled"])
        self.message.configure(state="disabled" if self.busy else "normal")

    def log(self, key, **values):
        self.output.configure(state="normal")
        self.output.insert("end", self.t(key, **values) + "\n")
        self.output.see("end")
        self.output.configure(state="disabled")

    def clear_output(self):
        self.output.configure(state="normal")
        self.output.delete("1.0", "end")
        self.output.configure(state="disabled")

    def report(self, key):
        self.log(key)
        messagebox.showerror(self.t("error"), self.t(key), parent=self.root)

    def start(self, work, status):
        if self.busy:
            return
        self.busy = True
        self.cancel.clear()
        self.status_key = status
        self.status_label.configure(text=self.t(status))
        self.progress.configure(value=0)
        self.update_buttons()

        def run():
            try:
                work()
            except (StopBatch, RecipientError, ValueError) as exc:
                self.events.put(("log", "failed", {"reason": str(exc)}))
            except OSError:
                self.events.put(("log", "storage_error", {}))
            except Exception:
                # Never dump requests, credentials or arbitrary exception reprs.
                self.events.put(("log", "unexpected", {}))
            finally:
                self.events.put(("done",))

        threading.Thread(target=run, daemon=True).start()

    def drain(self):
        try:
            while True:
                event = self.events.get_nowait()
                if event[0] == "log":
                    self.log(event[1], **event[2])
                elif event[0] == "account":
                    self.client, self.sender = event[1:]
                    self.account_label.configure(text=label(self.sender))
                    self.log("connected", account=label(self.sender))
                elif event[0] == "friends":
                    self.friends = event[1]
                    self.tree.delete(*self.tree.get_children())
                    for friend in self.friends:
                        self.tree.insert("", "end", iid=str(friend["id"]), values=(str(friend.get("name", friend["id"])), friend["id"]))
                    self.log("loaded", count=len(self.friends))
                elif event[0] == "progress":
                    self.progress.configure(maximum=max(event[2], 1), value=event[1])
                elif event[0] == "done":
                    self.busy = False
                    self.status_key = "ready"
                    self.status_label.configure(text=self.t("ready"))
                    self.update_buttons()
        except queue.Empty:
            pass
        self.root.after(80, self.drain)

    def connect(self):
        if self.busy:
            return
        try:
            cookie = load_cookie()
            if not cookie:
                cookie = simpledialog.askstring(self.t("cookie_title"), self.t("cookie_prompt"), show="*", parent=self.root)
            if not cookie:
                self.log("cancelled")
                return
            candidate = Roblox(cookie)
        except ValueError as exc:
            self.log("failed", reason=str(exc))
            return
        if self.client:
            self.client.cookie = self.client.csrf = ""
        self.client = self.sender = None
        self.friends = []
        self.tree.delete(*self.tree.get_children())
        self.account_label.configure(text=self.t("disconnected"))

        def work():
            account = candidate.me()
            if self.cancel.is_set():
                candidate.cookie = candidate.csrf = ""
                self.events.put(("log", "stopped", {}))
            else:
                self.events.put(("account", candidate, account))

        self.start(work, "connecting")

    def load_friends(self):
        if self.busy:
            return
        if not self.client:
            self.report("need_account")
            return
        client, sender = self.client, self.sender
        self.friends = []
        self.tree.delete(*self.tree.get_children())

        def work():
            friends = client.friends(sender["id"])
            if self.cancel.is_set():
                self.events.put(("log", "stopped", {}))
            else:
                self.events.put(("friends", friends))

        self.start(work, "loading")

    def prepare(self, selected=False):
        if not self.client:
            self.report("need_account")
            return None
        if not self.friends:
            self.report("need_friends")
            return None
        message = self.message.get("1.0", "end-1c").strip()
        if not message or len(message) > 1000:
            self.report("invalid_message")
            return None
        if "WARNING:-DO-NOT-SHARE" in message or ".ROBLOSECURITY" in message:
            self.report("secret")
            return None
        if selected:
            selection = self.tree.selection()
            if not selection:
                self.report("select")
                return None
            friends = [friend for friend in self.friends if str(friend["id"]) == selection[0]]
        else:
            friends = list(self.friends)
        try:
            # Reload persisted history immediately before preparing each operation.
            self.history = History() if self.history is None else History(self.history.path)
        except StopBatch as exc:
            self.log("failed", reason=str(exc))
            return None
        self.log("from", account=label(self.sender))
        self.log("announcement")
        self.output.configure(state="normal")
        self.output.insert("end", message + "\n")
        self.output.configure(state="disabled")
        pending = []
        for friend in friends:
            status = self.history.status(self.history.key(self.sender["id"], friend["id"], message))
            if status:
                self.log("skip", friend=label(friend), status=status)
            else:
                pending.append(friend)
                self.log("recipient", friend=label(friend))
        self.log("summary", count=len(pending))
        return message, pending

    def preview(self):
        if not self.busy:
            self.prepare()

    def send(self, selected=False):
        if self.busy:
            return
        prepared = self.prepare(selected)
        if prepared is None:
            return
        message, pending = prepared
        if not pending:
            self.log("none")
            return
        if not messagebox.askyesno(self.t("confirm_title"), self.t("confirm", count=len(pending), message=message), parent=self.root):
            self.log("cancelled")
            return
        client, sender, history = self.client, self.sender, self.history

        def work():
            accepted = rejected = attempted = 0
            self.events.put(("progress", 0, len(pending)))
            try:
                for index, friend in enumerate(pending):
                    if self.cancel.is_set() or (index and self.cancel.wait(DELAY)):
                        self.events.put(("log", "stopped", {}))
                        break
                    key = history.key(sender["id"], friend["id"], message)
                    try:
                        conversation = client.direct_conversation(sender["id"], friend["id"])
                    except RecipientError as exc:
                        rejected += 1
                        attempted += 1
                        self.events.put(("log", "rejected", {"friend": label(friend), "reason": str(exc)}))
                        self.events.put(("progress", attempted, len(pending)))
                        continue
                    if self.cancel.is_set():
                        self.events.put(("log", "stopped", {}))
                        break
                    history.record(key, friend["id"], "unknown")
                    attempted += 1
                    try:
                        message_id = client.send(conversation, message)
                    except RecipientError as exc:
                        history.record(key, friend["id"], "rejected")
                        rejected += 1
                        self.events.put(("log", "rejected", {"friend": label(friend), "reason": str(exc)}))
                    else:
                        history.record(key, friend["id"], "sent", message_id)
                        accepted += 1
                        self.events.put(("log", "accepted", {"friend": label(friend), "message_id": message_id}))
                    self.events.put(("progress", attempted, len(pending)))
            finally:
                self.events.put(("log", "finished", {"accepted": accepted, "rejected": rejected,
                                                      "unknown": attempted - accepted - rejected,
                                                      "remaining": len(pending) - attempted}))
                self.events.put(("progress", attempted, len(pending)))
                self.events.put(("log", "ack", {}))

        self.start(work, "sending")

    def stop(self):
        if self.busy:
            self.cancel.set()
            self.log("stopping")

    def close(self):
        if self.busy and not messagebox.askyesno(self.t("close_title"), self.t("close_busy"), parent=self.root):
            return
        self.cancel.set()
        if self.client and not self.busy:
            self.client.cookie = self.client.csrf = ""
        self.root.destroy()


def launch():
    import sys
    root = tk.Tk()
    if "--self-test" in sys.argv:
        # Packaged-runtime smoke test. It never loads a cookie or contacts Roblox.
        import json
        from pathlib import Path
        import tempfile
        from announcer import application_directory
        result_path = Path(sys.argv[sys.argv.index("--self-test") + 1])
        with tempfile.TemporaryDirectory() as directory:
            ui = Panel(root, History(Path(directory) / "history.json"))
            result = {"ok": False, "platform": sys.platform,
                      "data_directory": str(application_directory()),
                      "tk_version": str(root.tk.call("info", "patchlevel"))}

            def check():
                try:
                    ui.id_button.invoke()
                    assert ui.lang == "id" and root.title() == "Panel Pengumuman Roblox"
                    ui.en_button.invoke()
                    assert ui.lang == "en"
                    ui.message.insert("1.0", "Offline packaged runtime test")
                    ui.log("ready")
                    assert "Ready" in ui.output.get("1.0", "end")
                    assert ui.output.cget("state") == "disabled"
                    offline_client = Roblox("offline-self-test-cookie")
                    assert offline_client.opener is not None
                    result["ok"] = True
                finally:
                    result_path.write_text(json.dumps(result, indent=2), encoding="utf-8")
                    root.destroy()

            root.after(200, check)
            root.mainloop()
        return
    Panel(root)
    root.mainloop()


if __name__ == "__main__":
    launch()
