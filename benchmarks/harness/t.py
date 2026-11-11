import subprocess,sys,time,os
n=int(sys.argv[1]);cwd=sys.argv[2];cmd=sys.argv[3:];ts=[]
for _ in range(n):
    s=time.time();r=subprocess.run(cmd,cwd=cwd,capture_output=True);ts.append((time.time()-s)*1000)
ts.sort();print('%-50s min %5.0f med %5.0f max %5.0f  (exit %d)'%(' '.join(cmd)[-50:],ts[0],ts[n//2],ts[-1],r.returncode))
