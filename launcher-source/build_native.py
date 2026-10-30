"""Build the ordinary Windows x64 launcher with Clang and LLD.

Requires clang, lld-link and llvm-rc from the LLVM toolchain. No Windows runtime
or custom executable archive writer is used to generate this launcher.
"""
from pathlib import Path
import argparse
import shutil
import subprocess


def build(output, build_dir, clang, linker, resource_compiler):
    source = Path(__file__).resolve().parent
    build_dir.mkdir(parents=True, exist_ok=True)
    exports = {
        "kernel32": ["GetProcessHeap", "HeapAlloc", "HeapFree", "GetModuleFileNameW",
                     "GetFileAttributesW", "GetCommandLineW", "LocalFree", "CreateProcessW",
                     "CloseHandle", "WaitForSingleObject", "GetExitCodeProcess", "GetLastError",
                     "FormatMessageW", "ExitProcess"],
        "user32": ["MessageBoxW"],
        "shell32": ["CommandLineToArgvW"],
    }
    libraries = []
    for name, functions in exports.items():
        definition = build_dir / (name + ".def")
        library = build_dir / (name + ".lib")
        definition.write_text("LIBRARY " + name + ".dll\nEXPORTS\n" + "\n".join(functions) + "\n")
        subprocess.run([linker, "/lib", "/machine:x64", "/def:" + str(definition), "/out:" + str(library)], check=True)
        libraries.append(str(library))
    obj = build_dir / "launcher.obj"
    resource = build_dir / "launcher.res"
    subprocess.run([clang, "--target=x86_64-pc-windows-msvc", "-std=c11", "-O2",
                    "-Wall", "-Wextra", "-Werror", "-ffreestanding", "-fno-builtin",
                    "-c", str(source / "launcher.c"), "-o", str(obj)], check=True)
    subprocess.run([resource_compiler, "/fo", str(resource), "launcher.rc"], cwd=source, check=True)
    output.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run([linker, "/machine:x64", "/subsystem:windows", "/entry:mainCRTStartup",
                    "/nodefaultlib", "/dynamicbase", "/nxcompat", "/highentropyva", "/Brepro",
                    "/out:" + str(output), str(obj), str(resource), *libraries], check=True)
    print("Built native Windows launcher:", output)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("ServerHSystem.exe"))
    parser.add_argument("--build-dir", type=Path, default=Path("build-launcher"))
    parser.add_argument("--clang", default=shutil.which("clang"))
    parser.add_argument("--linker", default=shutil.which("lld-link"))
    parser.add_argument("--resource-compiler", default=shutil.which("llvm-rc"))
    args = parser.parse_args()
    if not all([args.clang, args.linker, args.resource_compiler]):
        parser.error("Clang, lld-link and llvm-rc are required.")
    build(args.output.resolve(), args.build_dir.resolve(), args.clang, args.linker, args.resource_compiler)
