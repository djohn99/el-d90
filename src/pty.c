// el-d90's small macOS PTY bridge. No third-party application code.
#include <util.h>
#include <fcntl.h>
#include <sys/ioctl.h>
#include <sys/wait.h>
#include <sys/select.h>
#include <unistd.h>
#include <signal.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static volatile sig_atomic_t stopping = 0;
static pid_t child_pid = -1;
static void stop(int signal_number) {
  (void)signal_number;
  stopping = 1;
  if (child_pid > 0) kill(-child_pid, SIGHUP);
}
static int write_all(int fd, const char *data, ssize_t count) {
  while (count > 0) {
    ssize_t n = write(fd, data, (size_t)count);
    if (n < 0) { if (errno == EINTR && !stopping) continue; return -1; }
    data += n; count -= n;
  }
  return 0;
}
int main(int argc, char **argv) {
  if (argc < 2) { fprintf(stderr, "Usage: el-d90-pty executable [args...]\n"); return 2; }
  signal(SIGPIPE, SIG_IGN);
  int master;
  int resize_fd = fcntl(3, F_GETFD) >= 0 ? 3 : -1;
  struct winsize size = { .ws_row = 28, .ws_col = 100 };
  child_pid = forkpty(&master, NULL, NULL, &size);
  if (child_pid < 0) { perror("forkpty"); return 1; }
  if (child_pid == 0) {
    if (resize_fd >= 0) close(resize_fd);
    setenv("TERM", "xterm-256color", 1);
    execvp(argv[1], &argv[1]);
    perror("execvp"); _exit(127);
  }
  struct sigaction action;
  memset(&action, 0, sizeof(action)); action.sa_handler = stop;
  sigemptyset(&action.sa_mask);
  sigaction(SIGTERM, &action, NULL); sigaction(SIGHUP, &action, NULL); sigaction(SIGINT, &action, NULL);
  char buffer[16384], resize_buffer[128];
  size_t resize_used = 0;
  while (!stopping) {
    fd_set readable; FD_ZERO(&readable); FD_SET(STDIN_FILENO, &readable); FD_SET(master, &readable);
    if (resize_fd >= 0) FD_SET(resize_fd, &readable);
    int ready = select((master > resize_fd ? master : resize_fd) + 1, &readable, NULL, NULL, NULL);
    if (ready < 0) { if (errno == EINTR) continue; break; }
    if (resize_fd >= 0 && FD_ISSET(resize_fd, &readable)) {
      char control[64]; ssize_t count = read(resize_fd, control, sizeof(control));
      if (count <= 0) resize_fd = -1;
      else for (ssize_t i = 0; i < count; i++) {
        if (control[i] == '\n') {
          resize_buffer[resize_used] = 0; int cols, rows;
          if (sscanf(resize_buffer, "%d %d", &cols, &rows) == 2 && cols >= 20 && cols <= 400 && rows >= 5 && rows <= 200) {
            struct winsize changed = {.ws_row = (unsigned short)rows, .ws_col = (unsigned short)cols};
            ioctl(master, TIOCSWINSZ, &changed);
          }
          resize_used = 0;
        } else if (resize_used < sizeof(resize_buffer) - 1) resize_buffer[resize_used++] = control[i];
        else resize_used = 0;
      }
    }
    if (FD_ISSET(master, &readable)) {
      ssize_t count = read(master, buffer, sizeof(buffer));
      if (count <= 0 || write_all(STDOUT_FILENO, buffer, count) < 0) break;
    }
    if (FD_ISSET(STDIN_FILENO, &readable)) {
      ssize_t count = read(STDIN_FILENO, buffer, sizeof(buffer));
      if (count <= 0 || write_all(master, buffer, count) < 0) break;
    }
  }
  close(master);
  kill(-child_pid, SIGHUP);
  int status = 0;
  // A stopped or unresponsive pod helper must not survive window closure.
  for (int i = 0; i < 30; i++) {
    pid_t reaped = waitpid(child_pid, &status, WNOHANG);
    if (reaped == child_pid || (reaped < 0 && errno == ECHILD)) return WIFEXITED(status) ? WEXITSTATUS(status) : 0;
    usleep(10000);
  }
  kill(-child_pid, SIGKILL);
  while (waitpid(child_pid, &status, 0) < 0 && errno == EINTR) {}
  return WIFEXITED(status) ? WEXITSTATUS(status) : 0;
}
