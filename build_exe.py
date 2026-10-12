"""Costruisce YuGiOhDeckBuilder.exe con PyInstaller.

    python build_exe.py

L'eseguibile finisce accanto a questo script, in un unico file che si porta
dentro l'interfaccia web. Sta nella cartella del progetto di proposito: cosi'
usa lo stesso archivio data/ di "python app.py", invece di crearne un altro.
"""
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
NAME = "YuGiOhDeckBuilder"


def main():
    try:
        import PyInstaller  # noqa: F401
    except ImportError:
        print("PyInstaller non e' installato. Installalo con:")
        print("    python -m pip install pyinstaller")
        return 1

    # --add-data vuole il separatore di percorso del sistema operativo.
    sep = ";" if os.name == "nt" else ":"
    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--onefile",
        "--name", NAME,
        "--add-data", os.path.join(ROOT, "web") + sep + "web",
        "--hidden-import", "ygodeck",
        "--distpath", ROOT,
        "--workpath", os.path.join(ROOT, "build"),
        "--specpath", os.path.join(ROOT, "build"),
        "--noconfirm",
        "--clean",
        os.path.join(ROOT, "launcher.py"),
    ]
    icon = os.path.join(ROOT, "web", "icon.ico")
    if os.path.exists(icon):
        cmd[2:2] = ["--icon", icon]

    print("Compilazione in corso, richiede circa un minuto...")
    result = subprocess.run(cmd, cwd=ROOT)
    if result.returncode != 0:
        return result.returncode

    exe = os.path.join(ROOT, NAME + (".exe" if os.name == "nt" else ""))
    print("\nFatto: %s" % exe)
    print("Dimensione: %.1f MB" % (os.path.getsize(exe) / 1048576))

    shutil.rmtree(os.path.join(ROOT, "build"), ignore_errors=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
