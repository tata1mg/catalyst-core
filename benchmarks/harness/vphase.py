import subprocess,time,os,json,sys
cc,vite,cwd=sys.argv[1],sys.argv[2],os.getcwd()
env=dict(os.environ,src_path=cwd,NODE_ENV='production',VITE_BUILD_MODE='true',APPLICATION='catalyst_app',CATALYST_OUTPUT_MODE='compact',NODE_OPTIONS=f'--loader {cc}/dist/vite/node-loader.mjs',filterKeys=json.dumps(['src_path','NODE_ENV','VITE_BUILD_MODE','APPLICATION']))
S=[vite,'build','--config','./dist/vite/vite.config.server.js','--ssr'];C=[vite,'build','--config','./dist/vite/vite.config.client.js']
def run(a,id):
    s=time.time();r=subprocess.run(['node']+a,cwd=cc,env=dict(env,CATALYST_VITE_CACHE_ID=id),capture_output=True,text=True);return (time.time()-s)*1000,r.returncode,(r.stderr+r.stdout)
for i in range(4):
    c,rc1,o1=run(C,'client');s,rc2,o2=run(S,'ssr');print(f'client {c:.0f} ms (rc {rc1})  ssr {s:.0f} ms (rc {rc2})')
print(o1[-600:] if rc1 else '')
