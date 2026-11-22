#include <fcntl.h>
#include <unistd.h>
#include <sys/mman.h>
#include <sys/socket.h>

int make_pipe(int fds[2]) {
    int r = pipe(fds);
    if (r == 0) {
        fcntl(fds[0], F_SETFD, FD_CLOEXEC);
        fcntl(fds[1], F_SETFD, FD_CLOEXEC);
    }
    return r;
}

int make_socket(void) {
    int s = socket(AF_INET, SOCK_STREAM, 0);
    if (s >= 0) fcntl(s, F_SETFL, O_NONBLOCK);
    return s;
}

int open_shared(void) {
    return shm_open("/demo", O_RDWR | O_CREAT, 0600);
}

int main(void) {
    int fds[2];
    if (make_pipe(fds) != 0) return 1;
    int s = make_socket();
    int m = open_shared();
    close(fds[0]);
    close(fds[1]);
    if (s >= 0) close(s);
    if (m >= 0) close(m);
    return 0;
}
