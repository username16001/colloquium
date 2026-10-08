"""Execute only curated bank examples in a resource-limited, audited process."""
import contextlib, io, json, os, pathlib, sys
sys.stdout.reconfigure(encoding='utf-8');sys.stderr.reconfigure(encoding='utf-8')
payload=json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
for dep in sys.argv[2:]:
    sys.path.insert(0,dep)
if os.name=='nt':
    sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent))
    from windows_limits import apply_limits
    _job=apply_limits()
else:
    import resource
    resource.setrlimit(resource.RLIMIT_CPU,(5,5))
    resource.setrlimit(resource.RLIMIT_FSIZE,(1024*1024,1024*1024))
# Imports may read libraries; examples may not read arbitrary user files or write outside cwd.
allowed=[pathlib.Path(sys.prefix).resolve(),pathlib.Path(sys.base_prefix).resolve(),pathlib.Path(__file__).resolve().parent,pathlib.Path.cwd().resolve()]
allowed.extend(pathlib.Path(x).resolve() for x in sys.argv[2:])
allowed.extend([pathlib.Path('/System'),pathlib.Path('/Library/Frameworks'),pathlib.Path('/usr'),pathlib.Path('/private/var/db'),pathlib.Path('/dev')])
def audit(event,args):
    if event.startswith(('socket.','subprocess.')) or event in ('os.system','os.posix_spawn','os.exec','os.fork'):
        raise PermissionError('External activity forbidden: '+event)
    if event=='open' and isinstance(args[0],(str,bytes)):
        p=pathlib.Path(os.fsdecode(args[0])).resolve()
        mode=args[1] or '';flags=args[2]
        writing=any(x in mode for x in 'wax+') or bool(flags & (os.O_WRONLY|os.O_RDWR|os.O_CREAT|os.O_TRUNC))
        if writing and (os.name=='nt' or not p.is_relative_to(pathlib.Path.cwd().resolve())):
            raise PermissionError('Write outside isolated cwd')
        if not writing and not any(p.is_relative_to(root) for root in allowed):
            raise PermissionError('Read outside example/library roots')
    if event in ('os.remove','os.rmdir','os.mkdir','os.rename','os.link','os.symlink','shutil.copyfile'):
        paths=args[:2] if event in ('os.rename','os.link','os.symlink','shutil.copyfile') else args[:1]
        if any(isinstance(p,(str,bytes)) and (os.name=='nt' or not pathlib.Path(os.fsdecode(p)).resolve().is_relative_to(pathlib.Path.cwd().resolve())) for p in paths):
            raise PermissionError('Filesystem mutation outside isolated example')
sys.addaudithook(audit)
class BoundedOutput(io.StringIO):
    def write(self,text):
        if self.tell()+len(text)>1024*1024:raise OSError('Example output limit exceeded')
        return super().write(text)
stream=BoundedOutput();error=None
try:
    with contextlib.redirect_stdout(stream):
        exec(compile(payload['code'],payload['id']+'.py','exec'),{'__name__':'__main__'})
except BaseException as exc:
    error=type(exc).__name__
sys.__stdout__.write(json.dumps({'stdout':stream.getvalue(),'exception':error},ensure_ascii=False))
