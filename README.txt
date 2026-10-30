ServerHSystem for Windows 64-bit - folder package 1.1.0

1. Extract the ENTIRE ZIP to a writable folder.
2. Keep ServerHSystem.exe, runtime, windows_start.pyw, panel.py and announcer.py together.
3. Copy .env.example to .env and enter your fresh cookie locally.
4. Open ServerHSystem.exe. Use the panel's English / Bahasa Indonesia buttons.

If you already have a .env or delivery-history.json, keep those files when updating.
The launcher requires the runtime folder; copying the EXE alone will not work.
Python does not need to be installed separately. The Mac DMG is unchanged.

Packaging change
The previous custom self-extracting EXE has been replaced by an ordinary native
Windows launcher. It starts the unmodified official Python runtime in runtime/.
The application source is readable beside the launcher. The launcher source,
manifest, version resource and build commands are in launcher-source/.
There is no self-extracting payload, packer, obfuscation, downloader, elevation,
automatic installation, startup registration or antivirus-setting change.

Defender status
This package has not been scanned with Windows Defender or run on Windows here.
Changing packaging does NOT establish that the earlier detection was false or
guarantee that a new warning will disappear. The custom launcher is unsigned.
No trusted code-signing certificate was available. SmartScreen reputation
warnings and Defender malware detections are different issues.

If Windows Security detects a threat, retain the exact detection name and use
Microsoft's official software-developer file review process:
https://www.microsoft.com/en-us/wdsi/filesubmission/
https://learn.microsoft.com/en-us/defender-xdr/developer-faq
Submit only the specific flagged program file. Do not submit .env or your cookie.
No Defender exclusions, allowlisting or protection-disabling scripts are provided.

Verification
See package-manifest.json for hashes and build details. Scan-With-Defender.ps1
can request a normal custom Defender scan of this folder on Windows. It never
disables protections or creates exclusions. Windows may require an administrator
PowerShell for the scan. Do not weaken script execution policy to run it.

Announcements still use the experimental website Chat API. Delivery to every
friend remains unverified. A successful package build is not a delivery test.
