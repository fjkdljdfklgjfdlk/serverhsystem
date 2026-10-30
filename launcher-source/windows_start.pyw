"""Start the panel using the adjacent standard Windows Python runtime."""
import os
from pathlib import Path
import traceback

root = Path(__file__).resolve().parent
runtime = root / "runtime"
os.environ["TCL_LIBRARY"] = str(runtime / "tcl" / "tcl8.6")
os.environ["TK_LIBRARY"] = str(runtime / "tcl" / "tk8.6")

try:
    from panel import launch
    launch()
except Exception:
    # This contains the startup traceback, not cookies or network request dumps.
    import tkinter as tk
    from tkinter import messagebox
    try:
        (root / "startup-error.txt").write_text(traceback.format_exc(), encoding="utf-8")
    except OSError:
        pass
    window = tk.Tk()
    window.withdraw()
    messagebox.showerror("ServerHSystem", "The panel could not start. See startup-error.txt in the application folder.")
    window.destroy()
    raise SystemExit(1)
