// Original Windows 10/11 ConPTY bridge. Same stdin/stdout + fd3 resize protocol
// as the macOS helper; all child processes belong to a kill-on-close Job.
#define _WIN32_WINNT 0x0A00
#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
#include <wchar.h>
#include <io.h>
#include <fcntl.h>
static HPCON console;
static HANDLE inputWrite, outputRead;
static DWORD WINAPI inputPump(void *unused){char b[16384];DWORD n,w;(void)unused;while(ReadFile(GetStdHandle(STD_INPUT_HANDLE),b,sizeof b,&n,NULL)&&n){DWORD p=0;while(p<n){if(!WriteFile(inputWrite,b+p,n-p,&w,NULL))return 0;p+=w;}}return 0;}
static DWORD WINAPI outputPump(void *unused){char b[16384];DWORD n,w;(void)unused;while(ReadFile(outputRead,b,sizeof b,&n,NULL)&&n){DWORD p=0;while(p<n){if(!WriteFile(GetStdHandle(STD_OUTPUT_HANDLE),b+p,n-p,&w,NULL))return 0;p+=w;}}return 0;}
static DWORD WINAPI resizePump(void *unused){char b[128];int used=0,n;char c;(void)unused;while((n=_read(3,&c,1))==1){if(c=='\n'){int cols,rows;b[used]=0;if(sscanf_s(b,"%d %d",&cols,&rows)==2&&cols>=20&&cols<=400&&rows>=5&&rows<=200){COORD size={(SHORT)cols,(SHORT)rows};ResizePseudoConsole(console,size);}used=0;}else if(used<127)b[used++]=c;else used=0;}return 0;}
// Quote according to CommandLineToArgvW/MSVC rules, with no shell interpolation.
static wchar_t *quote(wchar_t *out,const wchar_t *arg){*out++=L'"';while(*arg){unsigned slashes=0;while(*arg==L'\\'){slashes++;arg++;}if(*arg==L'"'){for(unsigned i=0;i<slashes*2+1;i++)*out++=L'\\';*out++=*arg++;}else if(!*arg){for(unsigned i=0;i<slashes*2;i++)*out++=L'\\';break;}else{for(unsigned i=0;i<slashes;i++)*out++=L'\\';*out++=*arg++;}}*out++=L'"';return out;}
int wmain(int argc,wchar_t **argv){
 if(argc<2)return 2;size_t chars=1;for(int i=1;i<argc;i++)chars+=wcslen(argv[i])*2+4;if(chars>32767){fprintf(stderr,"Terminal command is too long\n");return 2;}
 wchar_t *command=calloc(chars,sizeof(wchar_t)),*p=command;if(!command)return 2;for(int i=1;i<argc;i++){if(i>1)*p++=L' ';p=quote(p,argv[i]);}*p=0;
 HANDLE inputRead,outputWrite;if(!CreatePipe(&inputRead,&inputWrite,NULL,0)||!CreatePipe(&outputRead,&outputWrite,NULL,0))return 3;
 COORD size={100,28};if(FAILED(CreatePseudoConsole(size,inputRead,outputWrite,0,&console))){fprintf(stderr,"ConPTY unavailable; Windows 10 1809 or later is required\n");return 3;}
 SIZE_T bytes=0;InitializeProcThreadAttributeList(NULL,1,0,&bytes);STARTUPINFOEXW start={0};start.StartupInfo.cb=sizeof start;start.lpAttributeList=HeapAlloc(GetProcessHeap(),0,bytes);
 if(!start.lpAttributeList||!InitializeProcThreadAttributeList(start.lpAttributeList,1,0,&bytes)||!UpdateProcThreadAttribute(start.lpAttributeList,0,PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE,console,sizeof console,NULL,NULL))return 3;
 HANDLE job=CreateJobObjectW(NULL,NULL);JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits={0};limits.BasicLimitInformation.LimitFlags=JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;if(!job||!SetInformationJobObject(job,JobObjectExtendedLimitInformation,&limits,sizeof limits))return 3;
 PROCESS_INFORMATION child={0};if(!CreateProcessW(NULL,command,NULL,NULL,FALSE,EXTENDED_STARTUPINFO_PRESENT|CREATE_SUSPENDED,NULL,NULL,&start.StartupInfo,&child)){fprintf(stderr,"Terminal process creation failed: %lu\n",GetLastError());return 4;}
 if(!AssignProcessToJobObject(job,child.hProcess)){TerminateProcess(child.hProcess,4);return 4;}ResumeThread(child.hThread);CloseHandle(child.hThread);CloseHandle(inputRead);CloseHandle(outputWrite);free(command);DeleteProcThreadAttributeList(start.lpAttributeList);HeapFree(GetProcessHeap(),0,start.lpAttributeList);
 _setmode(0,_O_BINARY);_setmode(1,_O_BINARY);HANDLE outputThread=CreateThread(NULL,0,outputPump,NULL,0,NULL);CreateThread(NULL,0,inputPump,NULL,0,NULL);if(_get_osfhandle(3)!=-1)CreateThread(NULL,0,resizePump,NULL,0,NULL);
 WaitForSingleObject(child.hProcess,INFINITE);DWORD code=1;GetExitCodeProcess(child.hProcess,&code);ClosePseudoConsole(console);WaitForSingleObject(outputThread,5000);CloseHandle(child.hProcess);CloseHandle(job);return(int)code;
}
