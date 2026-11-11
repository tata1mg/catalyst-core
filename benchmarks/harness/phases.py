import subprocess,time,os,json,sys
cc=sys.argv[1];cwd=os.getcwd()
vite=subprocess.check_output(['node','-p',f"require('path').join(require('path').dirname(require.resolve('vite/package.json',{{paths:['{cc}']}})),'bin','vite.js')"]).decode().strip()
env=dict(os.environ,src_path=cwd,NODE_ENV='production',VITE_BUILD_MODE='true',APPLICATION='catalyst_app',CATALYST_OUTPUT_MODE='compact',NODE_OPTIONS=f'--loader {cc}/dist/vite/node-loader.mjs',filterKeys=json.dumps(['src_path','NODE_ENV','VITE_BUILD_MODE','APPLICATION']))
def run(args,extra,label,cwd_=cc):
    e=dict(env,**extra);s=time.time();subprocess.Popen(['node']+args,cwd=cwd_,env=e,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).wait();return (time.time()-s)*1000
S=[vite,'build','--config','./dist/vite/vite.config.server.js','--ssr'];C=[vite,'build','--config','./dist/vite/vite.config.client.js']
for i in range(5):
    c=run(C,{'CATALYST_VITE_CACHE_ID':'client'},'c');s=run(S,{'CATALYST_VITE_CACHE_ID':'ssr'},'s')
    m=run(['./dist/scripts/generateOfflineManifest.js'],{},'m')
    t=time.time();p1=subprocess.Popen(['node']+C,cwd=cc,env=dict(env,CATALYST_VITE_CACHE_ID='client'),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);p2=subprocess.Popen(['node']+S,cwd=cc,env=dict(env,CATALYST_VITE_CACHE_ID='ssr'),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);p1.wait();p2.wait();par=(time.time()-t)*1000
    print(f'client {c:.0f}  ssr {s:.0f}  manifest {m:.0f}  | client+ssr parallel {par:.0f}  | parallel+manifest {par+m:.0f} ms')
