/* ServerHSystem: ordinary Windows GUI launcher for the adjacent Python runtime.
 * No extraction, downloads, elevation, persistence or security-setting changes.
 */
#include "win32_minimal.h"

#define CAP 32768

static int append(wchar_t *out, size_t *used, wchar_t value) {
    if (*used >= CAP - 1) return 0;
    out[(*used)++] = value;
    out[*used] = L'\0';
    return 1;
}

/* Quote one argument using the Windows C-runtime argument parsing rules. */
static int argument(wchar_t *out, size_t *used, const wchar_t *value) {
    if (*used && !append(out, used, L' ')) return 0;
    if (!append(out, used, L'"')) return 0;
    while (*value) {
        size_t slashes = 0;
        while (*value == L'\\') { ++slashes; ++value; }
        if (*value == L'"' || !*value) slashes *= 2;
        while (slashes--) if (!append(out, used, L'\\')) return 0;
        if (!*value) break;
        if (*value == L'"' && !append(out, used, L'\\')) return 0;
        if (!append(out, used, *value++)) return 0;
    }
    return append(out, used, L'"');
}

static int join(wchar_t *output, const wchar_t *base, const wchar_t *suffix) {
    size_t used = 0;
    while (*base) if (!append(output, &used, *base++)) return 0;
    while (*suffix) if (!append(output, &used, *suffix++)) return 0;
    return 1;
}

static void zero_memory(void *memory, size_t size) {
    volatile unsigned char *bytes = memory;
    while (size--) *bytes++ = 0;
}

static int launcher_main(void) {
    HANDLE heap = GetProcessHeap();
    wchar_t *directory = HeapAlloc(heap, HEAP_ZERO_MEMORY, CAP * sizeof(wchar_t));
    wchar_t *python = HeapAlloc(heap, HEAP_ZERO_MEMORY, CAP * sizeof(wchar_t));
    wchar_t *script = HeapAlloc(heap, HEAP_ZERO_MEMORY, CAP * sizeof(wchar_t));
    wchar_t *args = HeapAlloc(heap, HEAP_ZERO_MEMORY, CAP * sizeof(wchar_t));
    int result = 1, argc = 0;
    wchar_t **argv = NULL;
    if (!directory || !python || !script || !args) goto cleanup;
    DWORD length = GetModuleFileNameW(NULL, directory, CAP);
    if (!length || length >= CAP) goto path_error;
    wchar_t *slash = NULL;
    for (wchar_t *p = directory; *p; ++p) if (*p == L'\\') slash = p;
    if (!slash) goto path_error;
    slash[1] = L'\0';
    if (!join(python, directory, L"runtime\\pythonw.exe") ||
        !join(script, directory, L"windows_start.pyw")) goto path_error;
    if (GetFileAttributesW(python) == INVALID_FILE_ATTRIBUTES ||
        GetFileAttributesW(script) == INVALID_FILE_ATTRIBUTES) {
        MessageBoxW(NULL,
            L"Extract the complete ServerHSystem folder before opening this app.\n"
            L"Keep runtime, windows_start.pyw, panel.py and announcer.py beside this EXE.",
            L"ServerHSystem: missing files", MB_OK | MB_ICONERROR);
        goto cleanup;
    }
    argv = CommandLineToArgvW(GetCommandLineW(), &argc);
    if (!argv) goto path_error;
    size_t used = 0;
    if (!argument(args, &used, python) || !argument(args, &used, L"-I") ||
        !argument(args, &used, script)) goto path_error;
    for (int index = 1; index < argc; ++index)
        if (!argument(args, &used, argv[index])) goto path_error;
    STARTUPINFOW startup;
    PROCESS_INFORMATION process;
    zero_memory(&startup, sizeof(startup));
    zero_memory(&process, sizeof(process));
    startup.cb = sizeof(startup);
    if (!CreateProcessW(python, args, NULL, NULL, FALSE, 0, NULL, directory,
                        &startup, &process)) {
        wchar_t error[512];
        DWORD count = FormatMessageW(0x1000 | 0x0200, NULL, GetLastError(), 0, error, 512, NULL);
        MessageBoxW(NULL, count ? error : L"The included Python runtime could not start.",
                    L"ServerHSystem", MB_OK | MB_ICONERROR);
        goto cleanup;
    }
    CloseHandle(process.hThread);
    WaitForSingleObject(process.hProcess, INFINITE);
    DWORD exit_code = 1;
    GetExitCodeProcess(process.hProcess, &exit_code);
    CloseHandle(process.hProcess);
    result = (int)exit_code;
    goto cleanup;
path_error:
    MessageBoxW(NULL, L"The application path or command line could not be read.",
                L"ServerHSystem", MB_OK | MB_ICONERROR);
cleanup:
    if (argv) LocalFree(argv);
    if (args) HeapFree(heap, 0, args);
    if (script) HeapFree(heap, 0, script);
    if (python) HeapFree(heap, 0, python);
    if (directory) HeapFree(heap, 0, directory);
    return result;
}

/* Standard PE entry point; the launcher uses only Win32 APIs and needs no CRT. */
void WINAPI mainCRTStartup(void) {
    ExitProcess((unsigned int)launcher_main());
}
