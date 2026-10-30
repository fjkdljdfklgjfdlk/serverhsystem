/* Minimal declarations for the documented Win32 APIs used by this launcher.
 * Windows x64 uses LLP64; these definitions are checked at compile time.
 */
#ifndef SERVERHSYSTEM_WIN32_MINIMAL_H
#define SERVERHSYSTEM_WIN32_MINIMAL_H
typedef __WCHAR_TYPE__ wchar_t;
typedef __SIZE_TYPE__ size_t;
typedef unsigned long DWORD;
typedef unsigned short WORD;
typedef int BOOL;
typedef void *HANDLE;
typedef void *HINSTANCE;
typedef wchar_t *PWSTR;
#define WINAPI __stdcall
#define API __declspec(dllimport)
#define NULL ((void *)0)
#define FALSE 0
#define HEAP_ZERO_MEMORY 8
#define INVALID_FILE_ATTRIBUTES ((DWORD)-1)
#define INFINITE ((DWORD)-1)
#define MB_OK 0
#define MB_ICONERROR 0x10
typedef struct {
    DWORD cb;
    PWSTR lpReserved, lpDesktop, lpTitle;
    DWORD dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
    WORD wShowWindow, cbReserved2;
    unsigned char *lpReserved2;
    HANDLE hStdInput, hStdOutput, hStdError;
} STARTUPINFOW;
typedef struct {
    HANDLE hProcess, hThread;
    DWORD dwProcessId, dwThreadId;
} PROCESS_INFORMATION;
_Static_assert(sizeof(DWORD) == 4, "Win32 DWORD must be 32 bits");
_Static_assert(sizeof(wchar_t) == 2, "Win32 wide characters must be 16 bits");
_Static_assert(sizeof(STARTUPINFOW) == 104, "Win64 STARTUPINFO layout mismatch");
_Static_assert(sizeof(PROCESS_INFORMATION) == 24, "Win64 PROCESS_INFORMATION layout mismatch");
API HANDLE WINAPI GetProcessHeap(void);
API void *WINAPI HeapAlloc(HANDLE, DWORD, size_t);
API BOOL WINAPI HeapFree(HANDLE, DWORD, void *);
API DWORD WINAPI GetModuleFileNameW(HINSTANCE, PWSTR, DWORD);
API DWORD WINAPI GetFileAttributesW(const wchar_t *);
API PWSTR WINAPI GetCommandLineW(void);
API void *WINAPI LocalFree(void *);
API BOOL WINAPI CreateProcessW(const wchar_t *, PWSTR, void *, void *, BOOL, DWORD, void *, const wchar_t *, STARTUPINFOW *, PROCESS_INFORMATION *);
API BOOL WINAPI CloseHandle(HANDLE);
API DWORD WINAPI WaitForSingleObject(HANDLE, DWORD);
API BOOL WINAPI GetExitCodeProcess(HANDLE, DWORD *);
API DWORD WINAPI GetLastError(void);
API DWORD WINAPI FormatMessageW(DWORD, const void *, DWORD, DWORD, PWSTR, DWORD, void *);
API void WINAPI ExitProcess(unsigned int);
API wchar_t **WINAPI CommandLineToArgvW(const wchar_t *, int *);
API int WINAPI MessageBoxW(void *, const wchar_t *, const wchar_t *, unsigned int);
#endif
