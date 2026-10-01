#!/usr/bin/env python3
"""Install a fail-closed seccomp network filter, then exec the fixed renderer."""

import ctypes
import errno
import os
import socket
import sys

PR_SET_NO_NEW_PRIVS = 38
SCMP_ACT_ALLOW = 0x7FFF0000
SCMP_ACT_ERRNO = 0x00050000 | errno.EPERM
SCMP_CMP_EQ = 4


class ScmpArgCmp(ctypes.Structure):
    _fields_ = [
        ("arg", ctypes.c_uint),
        ("op", ctypes.c_int),
        ("datum_a", ctypes.c_uint64),
        ("datum_b", ctypes.c_uint64),
    ]


def install_filter() -> None:
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0:
        raise OSError(ctypes.get_errno(), "prctl(PR_SET_NO_NEW_PRIVS) failed")

    seccomp = ctypes.CDLL("libseccomp.so.2", use_errno=True)
    seccomp.seccomp_init.argtypes = [ctypes.c_uint32]
    seccomp.seccomp_init.restype = ctypes.c_void_p
    seccomp.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
    seccomp.seccomp_syscall_resolve_name.restype = ctypes.c_int
    seccomp.seccomp_rule_add_array.argtypes = [
        ctypes.c_void_p,
        ctypes.c_uint32,
        ctypes.c_int,
        ctypes.c_uint,
        ctypes.POINTER(ScmpArgCmp),
    ]
    seccomp.seccomp_rule_add_array.restype = ctypes.c_int
    seccomp.seccomp_load.argtypes = [ctypes.c_void_p]
    seccomp.seccomp_load.restype = ctypes.c_int
    seccomp.seccomp_release.argtypes = [ctypes.c_void_p]

    context = seccomp.seccomp_init(SCMP_ACT_ALLOW)
    if not context:
        raise RuntimeError("seccomp_init failed")
    try:
        syscall_number = seccomp.seccomp_syscall_resolve_name(b"socket")
        if syscall_number < 0:
            raise RuntimeError("socket syscall unavailable")
        for family in (socket.AF_INET, socket.AF_INET6):
            comparison = ScmpArgCmp(0, SCMP_CMP_EQ, family, 0)
            result = seccomp.seccomp_rule_add_array(
                context, SCMP_ACT_ERRNO, syscall_number, 1, ctypes.byref(comparison)
            )
            if result != 0:
                raise RuntimeError(f"seccomp rule failed: {result}")
        result = seccomp.seccomp_load(context)
        if result != 0:
            raise RuntimeError(f"seccomp load failed: {result}")
    finally:
        seccomp.seccomp_release(context)


def main() -> int:
    allowed_commands = {"/usr/bin/libreoffice", "/usr/local/bin/rhwp"}
    if len(sys.argv) < 2 or sys.argv[1] not in allowed_commands:
        print("renderer command rejected", file=sys.stderr)
        return 126
    try:
        install_filter()
    except Exception as error:
        print(f"sandbox unavailable: {error}", file=sys.stderr)
        return 125
    os.umask(0o077)
    os.execve(sys.argv[1], sys.argv[1:], os.environ)
    return 126


if __name__ == "__main__":
    raise SystemExit(main())
