#include <sys/epoll.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <unistd.h>
#include <string.h>

#define MAXEV 16

int serve(int port) {
    int ls = socket(AF_INET, SOCK_STREAM, 0);
    struct sockaddr_in a;
    memset(&a, 0, sizeof a);
    a.sin_family = AF_INET;
    a.sin_port = htons(port);
    a.sin_addr.s_addr = htonl(INADDR_ANY);
    if (bind(ls, (struct sockaddr *)&a, sizeof a) < 0 || listen(ls, 16) < 0) return -1;

    int ep = epoll_create1(0);
    struct epoll_event ev;
    ev.events = EPOLLIN;
    ev.data.fd = ls;
    epoll_ctl(ep, EPOLL_CTL_ADD, ls, &ev);

    for (;;) {
        struct epoll_event evs[MAXEV];
        int n = epoll_wait(ep, evs, MAXEV, -1);
        for (int i = 0; i < n; i++) {
            int fd = evs[i].data.fd;
            if (fd == ls) {
                int c = accept(ls, 0, 0);
                ev.events = EPOLLIN;
                ev.data.fd = c;
                epoll_ctl(ep, EPOLL_CTL_ADD, c, &ev);
            } else {
                char buf[256];
                ssize_t r = read(fd, buf, sizeof buf);
                if (r <= 0) {
                    epoll_ctl(ep, EPOLL_CTL_DEL, fd, 0);
                    close(fd);
                } else {
                    write(fd, buf, (size_t)r);
                }
            }
        }
    }
}

int main(void) {
    return serve(7777) < 0;
}
