# Live-fix transcripts (PD4)

Each block is the exact request PortDoctor's fix loop built (prompt text; the full request incl. JSON schema is `<name>.req.json`) and the model's raw reply (`<name>.reply.json`).

**Provider: the author's own model session, not `providers/cli-provider.sh`.** The model CLI was refused on every host available (`Not logged in · Please run /login`; the OAuth session had expired), so the model call was made by the assistant that built this slice: **a model**, answering from the request text alone (prompt + 31-line code window, nothing else of the file), then the replies were replayed through `providers/replay.mjs` in the SDP sandbox. The unified diffs were typed by the model, then checked with `git apply --check` before the loop ran. Token usage is not recorded: there is no API frame for a session reply.

## libev: QNX-API-EVENTFD at ev.c:2390

Model: a model, via the author's session.

### Prompt

```text
You are helping port a Linux/POSIX C/C++ project to QNX 8.0.
A static scanner reported the finding below. Propose the smallest patch that resolves it.

Rule: QNX-API-EVENTFD (major, confidence verified-absent)
Problem: eventfd is a Linux file-descriptor wake-up primitive. It does not exist on QNX 8.0 (no <sys/eventfd.h>, no eventfd symbol, no EFD_* macro in SDP 8.0 build 141). [verified on SDP 8.0.0.00141T202311271501L by compile/link probe, not run on target: eventfd: not declared in any user header of the SDP and not exported by any SDP library; probe: 'eventfd' undeclared (first use in this function)]
Suggested direction: Use a pipe() or socketpair() pair when the consumer needs a pollable fd; use a pulse (MsgSendPulse / SIGEV_PULSE) when the consumer already sits in MsgReceive.
Scanner note: checked against the installed SDP (header, symbol and qcc probes); not executed on a QNX target.
Location: ev.c:2390

Code window (ev.c, lines 2375-2405, line numbers are not part of the file):
 2375| static ANSIG signals [EV_NSIG - 1];
 2376| 
 2377| /*****************************************************************************/
 2378| 
 2379| #if EV_SIGNAL_ENABLE || EV_ASYNC_ENABLE
 2380| 
 2381| static void noinline ecb_cold
 2382| evpipe_init (EV_P)
 2383| {
 2384|   if (!ev_is_active (&pipe_w))
 2385|     {
 2386|       int fds [2];
 2387| 
 2388| # if EV_USE_EVENTFD
 2389|       fds [0] = -1;
 2390|       fds [1] = eventfd (0, EFD_NONBLOCK | EFD_CLOEXEC);
 2391|       if (fds [1] < 0 && errno == EINVAL)
 2392|         fds [1] = eventfd (0, 0);
 2393| 
 2394|       if (fds [1] < 0)
 2395| # endif
 2396|         {
 2397|           while (pipe (fds))
 2398|             ev_syserr ("(libev) error creating signal/async pipe");
 2399| 
 2400|           fd_intern (fds [0]);
 2401|         }
 2402| 
 2403|       evpipe [0] = fds [0];
 2404| 
 2405|       if (evpipe [1] < 0)

Rules for your answer:
- Reply with ONE JSON object that matches the supplied JSON schema and nothing else.
- unifiedDiff must be a unified diff with a/ b/ path prefixes relative to the project root, applicable with `git apply`.
- Keep the Linux code path working (guard with #if defined(__QNXNTO__) or equivalent) unless the code is Linux-only by design.
- Only use QNX APIs you can name from public documentation. Do NOT invent header contents, constants or function signatures.
- List every QNX fact you relied on but could not verify in `assumptions` and `verifyAgainstSdp`.
- If no safe patch exists, set unifiedDiff to "" and needsHuman to true.

(code window ev.c lines 2375-2405 follows in the request)
```

### Raw reply

```json
{
  "unifiedDiff": "diff --git a/ev.c b/ev.c\n--- a/ev.c\n+++ b/ev.c\n@@ -2376,6 +2376,11 @@\n \n /*****************************************************************************/\n \n+#if defined(__QNXNTO__)\n+# undef EV_USE_EVENTFD\n+# define EV_USE_EVENTFD 0\n+#endif\n+\n #if EV_SIGNAL_ENABLE || EV_ASYNC_ENABLE\n \n static void noinline ecb_cold\n",
  "explanation": "eventfd does not exist on QNX 8.0 (finding says: no header, no symbol, no EFD_* macro). evpipe_init already has the portable fallback (pipe() + fd_intern) behind the \"if (fds [1] < 0)\" test, so the smallest change is to force EV_USE_EVENTFD to 0 on QNX before this block. That keeps every later use of the macro in the file (evpipe_write, pipecb) consistent with the pipe path, and leaves the Linux build untouched. I only see this window, so I did not touch earlier uses of EV_USE_EVENTFD (a possible #include <sys/eventfd.h> or the default selection of the macro).",
  "assumptions": [
    "EV_USE_EVENTFD is not used above line 2376 in a way that still needs eventfd on QNX (I cannot see the rest of ev.c; libev normally selects it only on Linux/glibc).",
    "The pipe() fallback path in evpipe_init works on QNX the same way (pipe and fcntl exist; not tested on a target)."
  ],
  "verifyAgainstSdp": [
    "grep ev.c for other uses of EV_USE_EVENTFD / sys/eventfd.h before this point"
  ],
  "confidence": "medium",
  "needsHuman": false
}
```

## dropbear: QNX-API-PRCTL at src/svr-main.c:79

Model: a model, via the author's session.

### Prompt

```text
You are helping port a Linux/POSIX C/C++ project to QNX 8.0.
A static scanner reported the finding below. Propose the smallest patch that resolves it.

Rule: QNX-API-PRCTL (major, confidence verified-absent)
Problem: prctl is a Linux process-control multiplexer. It does not exist on QNX 8.0 (no <sys/prctl.h>, no prctl symbol, no PR_* macro in SDP 8.0 build 141). [verified on SDP 8.0.0.00141T202311271501L by compile/link probe, not run on target: PR_SET_NAME: not declared in any user header of the SDP and not exported by any SDP library; probe: #error PR_SET_NAME not defined]
Suggested direction: Map each option individually: PR_SET_NAME -> pthread_setname_np() (declared and exported in SDP 8.0 build 141; so is pthread_getname_np); PR_SET_PDEATHSIG -> a parent-liveness check; PR_SET_DUMPABLE/NO_NEW_PRIVS -> drop (no QNX analogue is known).
Scanner note: checked against the installed SDP (header, symbol and qcc probes); not executed on a QNX target.
Location: src/svr-main.c:79

Code window (src/svr-main.c, lines 64-94, line numbers are not part of the file):
   64| 
   65| #if INETD_MODE
   66| 	/* service program mode */
   67| 	if (svr_opts.inetdmode) {
   68| 		main_inetd();
   69| 		/* notreached */
   70| 	}
   71| #endif
   72| 
   73| #if DROPBEAR_DO_REEXEC
   74| 	if (svr_opts.reexec_childpipe >= 0) {
   75| #ifdef PR_SET_NAME
   76| 		/* Fix the "Name:" in /proc/pid/status, otherwise it's
   77| 		a FD number from fexecve.
   78| 		Failure doesn't really matter, it's mostly aesthetic */
   79| 		prctl(PR_SET_NAME, basename(argv[0]), 0, 0);
   80| #endif
   81| 		main_inetd();
   82| 		/* notreached */
   83| 	}
   84| #endif
   85| 
   86| #if NON_INETD_MODE
   87| 	main_noinetd(argc, argv, multipath);
   88| 	/* notreached */
   89| #endif
   90| 
   91| 	dropbear_exit("Compiled without normal mode, can't run without -i\n");
   92| 	return -1;
   93| }
   94| #endif

Rules for your answer:
- Reply with ONE JSON object that matches the supplied JSON schema and nothing else.
- unifiedDiff must be a unified diff with a/ b/ path prefixes relative to the project root, applicable with `git apply`.
- Keep the Linux code path working (guard with #if defined(__QNXNTO__) or equivalent) unless the code is Linux-only by design.
- Only use QNX APIs you can name from public documentation. Do NOT invent header contents, constants or function signatures.
- List every QNX fact you relied on but could not verify in `assumptions` and `verifyAgainstSdp`.
- If no safe patch exists, set unifiedDiff to "" and needsHuman to true.

(code window src/svr-main.c lines 64-94 follows in the request)
```

### Raw reply

```json
{
  "unifiedDiff": "diff --git a/src/svr-main.c b/src/svr-main.c\n--- a/src/svr-main.c\n+++ b/src/svr-main.c\n@@ -77,6 +77,8 @@\n \t\ta FD number from fexecve.\n \t\tFailure doesn't really matter, it's mostly aesthetic */\n \t\tprctl(PR_SET_NAME, basename(argv[0]), 0, 0);\n+#elif defined(__QNXNTO__)\n+\t\tpthread_setname_np(pthread_self(), basename(argv[0]));\n #endif\n \t\tmain_inetd();\n \t\t/* notreached */\n",
  "explanation": "The only prctl use in the window is PR_SET_NAME, which the scanner direction maps to pthread_setname_np(). The existing #ifdef PR_SET_NAME block is already skipped on QNX (no PR_* macros), so I added an #elif for __QNXNTO__ that sets the thread name instead; the Linux path is unchanged. The name is cosmetic (the comment says failure does not matter), so I ignore the return value as the original does.",
  "assumptions": [
    "pthread_setname_np(pthread_t, const char *) is declared in <pthread.h> and that header is reachable through includes.h (the finding says it is declared and exported in SDP 8.0 build 141).",
    "QNX limits thread names to a fixed length and may return an error for longer ones; ignored here because the call is cosmetic.",
    "basename() is already available (it is used by the original line)."
  ],
  "verifyAgainstSdp": [
    "pthread_setname_np signature in <pthread.h>",
    "whether includes.h pulls in <pthread.h> on QNX"
  ],
  "confidence": "medium",
  "needsHuman": false
}
```

## iperf: QNX-API-SENDFILE at src/net.c:788

Model: a model, via the author's session.

### Prompt

```text
You are helping port a Linux/POSIX C/C++ project to QNX 8.0.
A static scanner reported the finding below. Propose the smallest patch that resolves it.

Rule: QNX-API-SENDFILE (major, confidence verified-absent)
Problem: Linux zero-copy file transfer calls. On SDP 8.0 build 141: splice, tee, vmsplice, copy_file_range and sendfile64 are not declared. sendfile() is declared in <sys/socket.h> with the BSD signature (7 arguments) but no SDP library exports it: linking fails (also with -lsocket). A same-named Linux call would not have compiled against that prototype anyway. [verified on SDP 8.0.0.00141T202311271501L by compile/link probe, not run on target: sendfile: declared (sys/socket.h:816 decl) but link fails with the default libraries, -lsocket and -lm: no SDP library exports it]
Suggested direction: Fall back to a read()/write() loop (or mmap + write) behind a small helper; add a platform fast path only if profiling demands it.
Scanner note: checked against the installed SDP (header, symbol and qcc probes); not executed on a QNX target.
Location: src/net.c:788

Code window (src/net.c, lines 773-803, line numbers are not part of the file):
  773| int
  774| Nsendfile(int fromfd, int tofd, const char *buf, size_t count)
  775| {
  776| #if defined(HAVE_SENDFILE)
  777|     off_t offset;
  778| #if defined(__FreeBSD__) || (defined(__APPLE__) && defined(__MACH__) && defined(MAC_OS_X_VERSION_10_6))
  779|     off_t sent;
  780| #endif
  781|     register size_t nleft;
  782|     register ssize_t r;
  783| 
  784|     nleft = count;
  785|     while (nleft > 0) {
  786| 	offset = count - nleft;
  787| #if defined(linux) || defined(__sun)
  788| 	r = sendfile(tofd, fromfd, &offset, nleft);
  789| 	if (r > 0)
  790| 	    nleft -= r;
  791| #elif defined(__FreeBSD__)
  792| 	r = sendfile(fromfd, tofd, offset, nleft, NULL, &sent, 0);
  793| 	nleft -= sent;
  794| #elif defined(__APPLE__) && defined(__MACH__) && defined(MAC_OS_X_VERSION_10_6)	/* OS X */
  795| 	sent = nleft;
  796| 	r = sendfile(fromfd, tofd, offset, &sent, NULL, 0);
  797| 	nleft -= sent;
  798| #else
  799| 	/* Shouldn't happen. */
  800| 	r = -1;
  801| 	errno = ENOSYS;
  802| #endif
  803| 	if (r < 0) {

Rules for your answer:
- Reply with ONE JSON object that matches the supplied JSON schema and nothing else.
- unifiedDiff must be a unified diff with a/ b/ path prefixes relative to the project root, applicable with `git apply`.
- Keep the Linux code path working (guard with #if defined(__QNXNTO__) or equivalent) unless the code is Linux-only by design.
- Only use QNX APIs you can name from public documentation. Do NOT invent header contents, constants or function signatures.
- List every QNX fact you relied on but could not verify in `assumptions` and `verifyAgainstSdp`.
- If no safe patch exists, set unifiedDiff to "" and needsHuman to true.

(code window src/net.c lines 773-803 follows in the request)
```

### Raw reply

```json
{
  "unifiedDiff": "diff --git a/src/net.c b/src/net.c\n--- a/src/net.c\n+++ b/src/net.c\n@@ -773,7 +773,7 @@\n int\n Nsendfile(int fromfd, int tofd, const char *buf, size_t count)\n {\n-#if defined(HAVE_SENDFILE)\n+#if defined(HAVE_SENDFILE) && !defined(__QNXNTO__)\n     off_t offset;\n #if defined(__FreeBSD__) || (defined(__APPLE__) && defined(__MACH__) && defined(MAC_OS_X_VERSION_10_6))\n     off_t sent;\n",
  "explanation": "The sendfile() call at line 788 sits in a \"defined(linux) || defined(__sun)\" branch, which a QNX compiler should not take, but the whole function is entered through HAVE_SENDFILE, and the finding says the SDP declares sendfile (BSD signature) without exporting it, so a header-only configure check could define HAVE_SENDFILE and then fail at link time. Excluding __QNXNTO__ here sends QNX to the function's non-sendfile branch, which I cannot see in this window, and leaves Linux/FreeBSD/macOS unchanged. A read()/write() loop would be the full replacement; I did not write one because I cannot see how callers handle the fallback.",
  "assumptions": [
    "Nsendfile has an #else branch (outside the window) that returns an error instead of calling sendfile, and callers cope with it (iperf only calls it with --zerocopy).",
    "sendfile is declared but not linkable on the QNX SDP, as the finding states."
  ],
  "verifyAgainstSdp": [
    "read the #else branch of Nsendfile below line 803",
    "confirm configure does not define HAVE_SENDFILE for QNX"
  ],
  "confidence": "medium",
  "needsHuman": true
}
```

