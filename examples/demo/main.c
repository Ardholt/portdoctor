#include <fcntl.h>
#include <unistd.h>
#include <sys/mman.h>
#include <sys/socket.h>

int make_pipe(int fds[2]) {
    return pipe2(fds, O_CLOEXEC);
}

int make_socket(void) {
    return socket(AF_INET, SOCK_STREAM | SOCK_NONBLOCK, 0);
}

int open_shared(void) {
    return open("/dev/shm/demo", O_RDWR | O_CREAT, 0600);
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
