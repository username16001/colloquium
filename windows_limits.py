"""Windows Job Object limits for the pre-reviewed example worker, not a sandbox."""
import ctypes
from ctypes import wintypes
import os


def apply_limits(cpu_seconds=5, memory_bytes=1024*1024*1024):
    if os.name != 'nt':
        raise RuntimeError('Windows Job Objects are only available on Windows')
    size = ctypes.c_size_t

    class Basic(ctypes.Structure):
        _fields_ = [('process_time', ctypes.c_longlong), ('job_time', ctypes.c_longlong),
                    ('flags', wintypes.DWORD), ('min_working', size), ('max_working', size),
                    ('active_processes', wintypes.DWORD), ('affinity', size),
                    ('priority', wintypes.DWORD), ('scheduling', wintypes.DWORD)]

    class IO(ctypes.Structure):
        _fields_ = [(name, ctypes.c_ulonglong) for name in
                    ['read_ops', 'write_ops', 'other_ops', 'read_bytes', 'write_bytes', 'other_bytes']]

    class Extended(ctypes.Structure):
        _fields_ = [('basic', Basic), ('io', IO), ('process_memory', size), ('job_memory', size),
                    ('peak_process', size), ('peak_job', size)]

    api = ctypes.WinDLL('kernel32', use_last_error=True)
    api.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
    api.CreateJobObjectW.restype = wintypes.HANDLE
    api.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
    api.SetInformationJobObject.restype = wintypes.BOOL
    api.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    api.AssignProcessToJobObject.restype = wintypes.BOOL
    api.GetCurrentProcess.restype = wintypes.HANDLE
    api.CloseHandle.argtypes = [wintypes.HANDLE]
    job = api.CreateJobObjectW(None, None)
    if not job:
        raise ctypes.WinError(ctypes.get_last_error())
    limits = Extended()
    limits.basic.process_time = int(cpu_seconds*10_000_000)
    # PROCESS_TIME | ACTIVE_PROCESS | PROCESS_MEMORY | KILL_ON_JOB_CLOSE
    limits.basic.flags = 0x2 | 0x8 | 0x100 | 0x2000
    limits.basic.active_processes = 1
    limits.process_memory = memory_bytes
    if not api.SetInformationJobObject(job, 9, ctypes.byref(limits), ctypes.sizeof(limits)) or not api.AssignProcessToJobObject(job, api.GetCurrentProcess()):
        error = ctypes.WinError(ctypes.get_last_error())
        api.CloseHandle(job)
        raise error
    # Keep this handle alive until process exit. Closing it terminates the worker.
    return job
