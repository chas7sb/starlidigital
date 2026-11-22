#define _GNU_SOURCE
#include <sys/syscall.h>
#include <sys/resource.h>
#include <signal.h>
#include <unistd.h>
#include <stdlib.h>
#include <stdio.h>
#include <errno.h>
int main(int argc,char **argv){
 if(argc!=2)return 2;
 pid_t outside=(pid_t)strtol(argv[1],NULL,10);if(outside<=1||outside==getpid())return 2;
 errno=0;long k=syscall(SYS_kill,outside,SIGTERM);int kill_denied=k==-1&&errno==EPERM;
 siginfo_t info={0};info.si_signo=SIGTERM;info.si_code=SI_QUEUE;info.si_pid=getpid();info.si_uid=getuid();
 errno=0;long q=syscall(SYS_rt_sigqueueinfo,outside,SIGTERM,&info);int queue_denied=q==-1&&errno==EPERM;
 errno=0;long tq=syscall(SYS_rt_tgsigqueueinfo,outside,outside,SIGTERM,&info);int thread_queue_denied=tq==-1&&errno==EPERM;
 errno=0;long x=syscall(0x40000000UL|SYS_getpid);int x32_denied=x==-1&&errno==EPERM;
 struct rlimit lim;errno=0;long p=syscall(SYS_prlimit64,outside,RLIMIT_NOFILE,NULL,&lim);int limits_denied=p==-1&&errno==EPERM;
 errno=0;long own=syscall(SYS_tgkill,getpid(),syscall(SYS_gettid),0);int own_ok=own==0;
 printf("{\"sameUidOutsideSignalDenied\":%s,\"queuedSignalsDenied\":%s,\"x32SyscallDenied\":%s,\"foreignProcessLimitsDenied\":%s,\"ownThreadSignalCheckWorks\":%s}\n",kill_denied?"true":"false",queue_denied&&thread_queue_denied?"true":"false",x32_denied?"true":"false",limits_denied?"true":"false",own_ok?"true":"false");
 return kill_denied&&queue_denied&&thread_queue_denied&&x32_denied&&limits_denied&&own_ok?0:1;
}
