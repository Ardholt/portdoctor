#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>

/* Boot-time check for the patched epoll demo: connect to the echo server on 127.0.0.1:7777, send a line, expect it back. */
int main(void) {
    int s = socket(AF_INET, SOCK_STREAM, 0);
    struct sockaddr_in a;
    memset(&a, 0, sizeof a);
    a.sin_family = AF_INET;
    a.sin_port = htons(7777);
    a.sin_addr.s_addr = inet_addr("127.0.0.1");
    if (s < 0 || connect(s, (struct sockaddr *)&a, sizeof a) < 0) { perror("PD-CLIENT connect"); return 1; }
    const char *msg = "hello from portdoctor\n";
    char buf[64] = {0};
    write(s, msg, strlen(msg));
    ssize_t n = read(s, buf, sizeof buf - 1);
    if (n > 0 && strcmp(buf, msg) == 0) { printf("PD-CLIENT echo ok: %s", buf); return 0; }
    printf("PD-CLIENT echo mismatch (%zd bytes)\n", n);
    return 2;
}
