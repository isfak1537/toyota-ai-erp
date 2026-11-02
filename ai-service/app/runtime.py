"""Fail early, with a clear message, on an unsupported Python."""

import sys

MIN_PYTHON = (3, 11)
RECOMMENDED = "3.12"


def check_python(version_info=None) -> None:
    version = tuple(version_info if version_info is not None else sys.version_info[:3])

    if version[:2] < MIN_PYTHON:
        found = ".".join(str(part) for part in version)
        needed = ".".join(str(part) for part in MIN_PYTHON)
        raise RuntimeError(
            f"The AI service needs Python {needed} or newer (recommended {RECOMMENDED}); "
            f"this interpreter is {found}. Create the venv with an explicit interpreter, "
            f"e.g. python3.12 -m venv .venv"
        )
