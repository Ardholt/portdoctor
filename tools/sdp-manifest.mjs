#!/usr/bin/env node
// sdp-manifest: derive an API/header/library presence manifest from an installed QNX SDP.
// Run INSIDE the sandbox jail with the SDP env sourced (QNX_TARGET set):
//   tools/jail.sh <node> tools/sdp-manifest.mjs --out data/sdp-8.0-manifest.json [--names extra.txt]
// It reads headers/libs and runs qcc/nm. It writes DERIVED FACTS ONLY (names, booleans, header paths, versions): no vendor text is copied.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdirSync, readFileSync, writeFileSync, statSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
const run = promisify(execFile);

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const OUT = opt('--out', 'sdp-manifest.json');
const BUILD = opt('--build', '');
const TARGET = process.env.QNX_TARGET;
if (!TARGET) { console.error('QNX_TARGET not set: source qnxsdp-env.sh in the jail'); process.exit(2); }
const ARCHES = [
  { name: 'x86_64', V: 'gcc_ntox86_64', nm: 'x86_64-pc-nto-qnx8.0.0-nm' },
  { name: 'aarch64le', V: 'gcc_ntoaarch64le', nm: 'aarch64-unknown-nto-qnx8.0.0-nm' },
];
const archInc = { x86_64: 'x86_64', aarch64le: 'aarch64' };
const TMP = join(process.env.TMPDIR || '/tmp', 'sdpm' + process.pid);
mkdirSync(TMP, { recursive: true });

// ---------- what to ask about ----------
const F = (s) => s.trim().split(/\s+/).map((n) => [n, 'func']);
const M = (s) => s.trim().split(/\s+/).map((n) => [n, 'macro']);
const T = (s) => s.trim().split(/\s+/).map((n) => [n, 'struct']);
const TD = (s) => s.trim().split(/\s+/).map((n) => [n, 'typedef']);
const NAMES = [
  ...F(`epoll_create epoll_create1 epoll_ctl epoll_wait epoll_pwait epoll_pwait2 inotify_init inotify_init1 inotify_add_watch inotify_rm_watch
    eventfd eventfd_read eventfd_write timerfd_create timerfd_settime timerfd_gettime signalfd accept4 pipe2 dup3 memfd_create kqueue kevent
    getrandom getentropy gettid sendfile sendfile64 splice tee vmsplice copy_file_range clone unshare setns prctl
    sched_setaffinity sched_getaffinity pthread_setaffinity_np pthread_getaffinity_np pthread_attr_setaffinity_np pthread_getattr_np
    pthread_tryjoin_np pthread_timedjoin_np pthread_yield pthread_setname_np pthread_getname_np getpeereid sysinfo syscall getauxval mremap
    shmget shmat shmctl semget semop semctl msgget msgsnd msgrcv msgctl ftok shm_open shm_unlink fallocate posix_fallocate fdatasync
    ppoll pselect poll strlcpy strlcat reallocarray explicit_bzero memrchr strchrnul strndup strnlen mempcpy asprintf vasprintf getline getdelim
    qsort_r fopencookie open_memstream fmemopen clock_nanosleep clock_gettime timer_create mq_open sem_timedwait pthread_mutex_timedlock
    pthread_condattr_setclock pthread_barrier_init pthread_spin_init sched_yield sched_getcpu getifaddrs freeifaddrs if_nametoindex if_nameindex
    dlopen dlsym backtrace backtrace_symbols mkostemp mkstemps recvmmsg sendmmsg posix_spawn vfork fork execvpe fexecve statfs fstatfs statvfs
    readahead sync_file_range posix_fadvise madvise mlock2 pwritev preadv pwritev2 openat utimensat futimens renameat2 secure_getenv
    getrlimit ptsname posix_openpt grantpt unlockpt openpty forkpty login_tty daemon setproctitle getprogname setprogname
    _cmdname ThreadCtl ionotify MsgReceive ChannelCreate sigtimedwait sigwaitinfo getgrouplist initgroups crypt nanosleep getloadavg sysconf
    close_range closefrom mount umount2 chroot pivot_root capget getresuid setresuid setresgid fdopendir scandirat strerror_r strsignal
    lseek64 open64 fopen64 mmap64 pread64 pwrite64 ftruncate64 readdir64 getcontext makecontext swapcontext aligned_alloc posix_memalign memalign
    malloc_usable_size valloc sysctl sysctlbyname uname gethostbyname_r getaddrinfo getnameinfo inet_pton socketpair sendmsg recvmsg
    strptime timegm timespec_get localtime_r gmtime_r tzset pthread_setschedparam pthread_getcpuclockid pthread_rwlock_timedrdlock
    getgrnam_r getpwnam_r wordexp glob fnmatch regcomp
    pthread_create pthread_attr_setstacksize pthread_cond_timedwait sigaltstack sigqueue timer_settime mkfifo mknod
    getdtablesize getpagesize ioctl fcntl flock lockf futex pthread_mutexattr_setrobust`),
  ...M(`SOCK_NONBLOCK SOCK_CLOEXEC MSG_NOSIGNAL MSG_MORE MSG_DONTWAIT MSG_CMSG_CLOEXEC MSG_WAITALL MSG_PEEK
    TCP_FASTOPEN TCP_INFO TCP_CORK TCP_QUICKACK TCP_DEFER_ACCEPT TCP_USER_TIMEOUT TCP_NODELAY TCP_KEEPIDLE TCP_KEEPINTVL TCP_KEEPCNT TCP_MAXSEG TCP_CONGESTION
    SO_REUSEPORT SO_BINDTODEVICE SO_PEERCRED LOCAL_PEERCRED SO_REUSEADDR SO_KEEPALIVE SO_RCVTIMEO SO_SNDTIMEO SO_DOMAIN SO_PROTOCOL SO_PRIORITY SO_MARK SO_BUSY_POLL
    AF_NETLINK PF_NETLINK AF_PACKET AF_UNIX AF_LOCAL AF_INET6 NETLINK_ROUTE IPV6_V6ONLY IP_PKTINFO IP_MTU_DISCOVER IP_RECVERR IP_FREEBIND IP_TRANSPARENT IP_MULTICAST_ALL
    SHM_ANON O_PATH O_DIRECT O_TMPFILE O_NOATIME O_CLOEXEC O_NONBLOCK O_DIRECTORY O_NOFOLLOW O_SYNC O_DSYNC O_LARGEFILE
    F_DUPFD_CLOEXEC F_SETPIPE_SZ F_GETPIPE_SZ F_OFD_SETLK F_OFD_SETLKW F_OFD_GETLK F_ADD_SEALS F_GET_SEALS F_SETLEASE F_GETLEASE F_SETSIG FD_CLOEXEC
    EPOLLIN EPOLLOUT EPOLLET EPOLLERR EPOLLHUP EPOLLRDHUP EPOLLONESHOT EPOLL_CTL_ADD EPOLL_CTL_DEL EPOLL_CTL_MOD EPOLL_CLOEXEC
    IN_CREATE IN_MODIFY IN_DELETE IN_MOVED_FROM IN_MOVED_TO IN_NONBLOCK IN_CLOEXEC EFD_NONBLOCK EFD_CLOEXEC EFD_SEMAPHORE TFD_NONBLOCK TFD_CLOEXEC TFD_TIMER_ABSTIME
    MFD_CLOEXEC MFD_ALLOW_SEALING GRND_NONBLOCK GRND_RANDOM MAP_ANONYMOUS MAP_ANON MAP_POPULATE MAP_HUGETLB MAP_GROWSDOWN MAP_NORESERVE MAP_FIXED_NOREPLACE
    CLOCK_BOOTTIME CLOCK_MONOTONIC_RAW CLOCK_MONOTONIC_COARSE CLOCK_REALTIME_COARSE CLOCK_TAI CLOCK_REALTIME_ALARM CLOCK_BOOTTIME_ALARM CLOCK_MONOTONIC CLOCK_PROCESS_CPUTIME_ID
    SCHED_BATCH SCHED_IDLE SCHED_DEADLINE SCHED_OTHER SCHED_FIFO SCHED_RR PR_SET_NAME PR_GET_NAME PR_SET_PDEATHSIG PR_SET_DUMPABLE
    CLONE_NEWNS CLONE_VM CLONE_FILES CLONE_THREAD PTHREAD_MUTEX_RECURSIVE_NP PTHREAD_MUTEX_ROBUST PTHREAD_PROCESS_SHARED
    PATH_MAX NAME_MAX IOV_MAX HOST_NAME_MAX ENODATA ENOTSUP EOPNOTSUPP ENOTRECOVERABLE POLLRDHUP POLLNVAL _POSIX_VERSION
    _SC_NPROCESSORS_ONLN _SC_PHYS_PAGES _SC_AVPHYS_PAGES _SC_PAGESIZE _SC_NPROCESSORS_CONF RLIMIT_NOFILE RLIMIT_AS SIGRTMIN SIGSTKFLT SIGPWR SA_RESTART SA_NOCLDWAIT SA_ONSTACK SA_SIGINFO
    CPU_SET CPU_ZERO CPU_ISSET CPU_CLR CPU_COUNT CPU_SETSIZE BYTE_ORDER LITTLE_ENDIAN __linux__ __gnu_linux__ __QNXNTO__ __QNX__ _GNU_SOURCE _QNX_SOURCE _DEFAULT_SOURCE
    LOG_PERROR MAP_FAILED SEEK_DATA SEEK_HOLE AT_FDCWD AT_EMPTY_PATH RENAME_NOREPLACE UTIME_NOW CMSG_FIRSTHDR SCM_RIGHTS SCM_CREDENTIALS
    PTHREAD_STACK_MIN SOMAXCONN`),
  ...T(`epoll_event inotify_event signalfd_siginfo sysinfo ucred cpu_set_t sockaddr_nl sockaddr_un sockaddr_storage itimerspec msghdr cmsghdr ifreq ifaddrs
    pollfd iovec statfs statvfs mmsghdr in6_pktinfo ip_mreqn linger rlimit sched_param kevent fuse_operations sockaddr_ll`),
  ...TD(`pthread_barrier_t pthread_spinlock_t sem_t cpu_set_t pid_t off64_t ino64_t socklen_t`),
];
const extra = opt('--names', null);
const XHEADERS = [], XLIBS = [], FLAGS = [];
if (extra && existsSync(extra)) for (const l of readFileSync(extra, 'utf8').split('\n')) {
  const [n, k] = l.trim().split(/\s+/);
  if (!n || n.startsWith('#')) continue;
  if (k === 'header') XHEADERS.push(n); else if (k === 'lib') XLIBS.push(n); else if (k === 'flag') FLAGS.push(n);
  else if (!NAMES.find((x) => x[0] === n)) NAMES.push([n, k || 'func']);
}
const HEADERS0 = `sys/epoll.h sys/inotify.h sys/eventfd.h sys/signalfd.h sys/timerfd.h sys/prctl.h sys/sendfile.h sys/auxv.h sys/sysinfo.h sys/fanotify.h sys/mman.h
  sys/syscall.h sys/random.h sys/event.h sys/ucred.h sys/vfs.h sys/statfs.h sys/mount.h sys/uio.h sys/un.h sys/socket.h sys/ioctl.h sys/select.h sys/poll.h poll.h
  sys/sysctl.h sys/resource.h sys/param.h sys/endian.h endian.h byteswap.h malloc.h alloca.h execinfo.h elf.h link.h ucontext.h features.h error.h err.h libgen.h
  linux/types.h linux/limits.h linux/version.h linux/tcp.h linux/netlink.h linux/if.h linux/if_ether.h linux/input.h linux/fs.h linux/futex.h linux/errqueue.h linux/in6.h
  linux/udp.h linux/pkt_sched.h linux/sockios.h linux/ioctl.h linux/sched.h linux/random.h asm/types.h asm/ioctl.h asm/unistd.h asm-generic/errno.h
  netinet/tcp.h netinet/in.h netinet/ip.h net/if.h net/if_arp.h net/ethernet.h netpacket/packet.h arpa/inet.h netdb.h ifaddrs.h net/route.h
  pty.h util.h libutil.h utmp.h utmpx.h mntent.h sys/queue.h sys/tree.h sys/cdefs.h sys/types.h sys/time.h sys/stat.h sys/wait.h sys/file.h sys/shm.h sys/sem.h sys/ipc.h sys/msg.h
  sys/user.h sys/reg.h sys/ptrace.h sys/personality.h sys/capability.h sys/xattr.h sys/acct.h sys/klog.h sys/swap.h sys/reboot.h sys/vt.h sys/kd.h sys/timeb.h sys/times.h sys/utsname.h
  sys/stropts.h stropts.h spawn.h semaphore.h pthread.h sched.h mqueue.h dlfcn.h threads.h stdatomic.h stdalign.h uchar.h entropy.h
  sys/neutrino.h sys/dispatch.h sys/iofunc.h sys/procfs.h sys/syspage.h sys/netmgr.h sys/slog2.h sys/siginfo.h sys/sched.h sys/mman.h sys/iomsg.h hw/inout.h
  fuse.h systemd/sd-daemon.h libudev.h dbus/dbus.h selinux/selinux.h libcap.h openssl/ssl.h zlib.h curl/curl.h bsd/string.h stdio.h stdlib.h unistd.h string.h strings.h fcntl.h signal.h time.h
  dirent.h termios.h pwd.h grp.h syslog.h ftw.h glob.h regex.h wordexp.h iconv.h locale.h langinfo.h inttypes.h stdint.h stdbool.h math.h complex.h fenv.h`.trim().split(/\s+/);
const HEADERS = [...new Set([...HEADERS0, ...XHEADERS])];
const LIBS0 = 'c m rt pthread dl nsl socket util resolv crypt anl c++ stdc++ regex gcc_s atomic z ssl crypto curl pcap ncurses curses readline sqlite3 xml2 uuid fuse ev uv intl iconv'.split(' ');
const LIBS = [...new Set([...LIBS0, ...XLIBS])];
const COMMON = ['stdio.h', 'stdlib.h', 'string.h', 'unistd.h', 'fcntl.h', 'signal.h', 'time.h', 'errno.h', 'limits.h', 'sys/types.h', 'sys/stat.h', 'sys/socket.h', 'sys/mman.h', 'sys/time.h', 'sys/uio.h',
  'netinet/in.h', 'netinet/tcp.h', 'arpa/inet.h', 'net/if.h', 'ifaddrs.h', 'sys/un.h', 'poll.h', 'pthread.h', 'sched.h', 'semaphore.h', 'dlfcn.h', 'sys/resource.h', 'sys/wait.h', 'netdb.h', 'sys/ioctl.h', 'sys/select.h', 'sys/statvfs.h', 'sys/utsname.h', 'dirent.h', 'termios.h', 'spawn.h', 'mqueue.h', 'math.h', 'malloc.h', 'sys/neutrino.h', 'sys/netmgr.h'];

// ---------- pool ----------
async function pool(items, n, fn) {
  const res = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; res[k] = await fn(items[k], k); } }));
  return res;
}
let seq = 0;
async function qcc(V, src, extra, link) {
  const f = join(TMP, `p${seq++}.c`); writeFileSync(f, src);
  const a = [`-V${V}`, ...(link ? ['-o', join(TMP, 'out' + seq)] : ['-c', '-o', join(TMP, 'o' + seq + '.o')]), ...extra, f];
  try { await run('qcc', a, { timeout: 60000 }); return { ok: true }; }
  catch (e) { return { ok: false, err: String(e.stderr || e.message).split('\n').filter((l) => /error|cannot find|undefined/.test(l)).slice(0, 1).join('').replace(/\/var\/lib\S*\//g, '').slice(0, 160) }; }
}

// ---------- header index ----------
function stripComments(t) { return t.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/\/\/[^\n]*/g, ''); }
function walk(dir, base, out) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (!/^(python3|libpng|tiff|vulkan|GLES|EGL|KHR|openssl|libxml|ucl|lz4|lzma|lzo)/.test(e.name) || dir !== base) walk(p, base, out); else walk(p, base, out); }
    else if (/\.(h|hh|hpp)$/.test(e.name) || !e.name.includes('.')) out.push(relative(base, p));
  }
}
const wanted = new Set(NAMES.map((n) => n[0]));
function indexHeaders(root, skipDirs) {
  const files = []; walk(root, root, files);
  const idx = new Map(); const present = new Set();
  const idRe = /[A-Za-z_][A-Za-z0-9_]*/g;
  for (const rel of files) {
    if (skipDirs.some((d) => rel === d || rel.startsWith(d + '/'))) continue;
    present.add(rel);
    let text; try { text = stripComments(readFileSync(join(root, rel), 'utf8')); } catch { continue; }
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]; if (l.length > 2000) continue;
      let m; idRe.lastIndex = 0;
      while ((m = idRe.exec(l))) {
        const id = m[0]; if (!wanted.has(id)) continue;
        const before = l.slice(0, m.index), after = l.slice(m.index + id.length);
        let how = 'mention';
        if (/^\s*#\s*define\s*$/.test(before)) how = 'define';
        else if (/^\s*#\s*(ifn?def|if|elif|undef)\b/.test(before)) how = 'cond';
        else if (/\b(struct|union|enum)\s+$/.test(before)) how = 'type';
        else if (/\btypedef\b/.test(before + after) && /\b\w+\s*;?\s*$/.test(l)) how = 'typedef';
        else if (/^\s*\(/.test(after) && !/^\s*#/.test(before)) how = /^[^()]*\b[\w*]+\s+\**\s*$/.test(before) || /\b(extern|int|void|char|long|size_t|ssize_t|unsigned|const)\b/.test(before) ? 'decl' : 'call';
        else if (/^\s*[,=}]/.test(after) || /^\s*$/.test(after)) how = /^\s*[A-Z_0-9]+\s*(=|,)?\s*$/.test(l) ? 'enum' : 'mention';
        let arr = idx.get(id); if (!arr) idx.set(id, (arr = []));
        if (arr.length < 400) arr.push({ h: rel, l: i + 1, how });
      }
    }
  }
  return { idx, present, count: files.length };
}

// ---------- symbols ----------
async function symbols(arch) {
  const map = new Map();
  for (const sub of ['lib', 'usr/lib']) {
    const dir = join(TARGET, arch.name, sub); if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!/^lib[\w+-]+\.so(\.\d+)*$/.test(f)) continue;
      try {
        const { stdout } = await run(arch.nm, ['-D', '--defined-only', join(dir, f)], { maxBuffer: 1 << 28 });
        for (const l of stdout.split('\n')) { const p = l.trim().split(/\s+/); const n = p[p.length - 1]; if (p.length >= 3 && wanted.has(n)) { const stem = f.replace(/\.so.*$/, ''); if (/^lib(asan|lsan|ubsan|unbound)$/.test(stem)) continue; const a = map.get(n) || new Set(); a.add(stem); map.set(n, a); } }
      } catch { /* not an ELF dynsym lib */ }
    }
    for (const f of ['libc.a']) {
      const p = join(dir, f); if (!existsSync(p)) continue;
      try {
        const { stdout } = await run(arch.nm, ['-g', '--defined-only', p], { maxBuffer: 1 << 29 });
        for (const l of stdout.split('\n')) { const q = l.trim().split(/\s+/); const n = q[q.length - 1]; if (q.length === 3 && wanted.has(n)) { const a = map.get(n) || new Set(); a.add('libc.a'); map.set(n, a); } }
      } catch { /* ignore */ }
    }
  }
  return map;
}

// ---------- probes ----------
function probeSrc(kind, name, incs, gnu) {
  const head = (gnu === 'gnu' ? '#define _GNU_SOURCE 1\n' : gnu === 'ext' ? '#define _GNU_SOURCE 1\n#define _QNX_SOURCE 1\n#define __EXT_UNIX_HIST 1\n#define _DEFAULT_SOURCE 1\n' : '') + incs.map((h) => `#include <${h}>`).join('\n') + '\n';
  if (kind === 'func') return head + `void *p_(void){ return (void*)${name}; }\nint main(void){ return p_()==0; }\n`;
  if (kind === 'macro') return head + `#ifndef ${name}\n#error ${name} not defined\n#endif\nint main(void){return 0;}\n`;
  if (kind === 'struct') return head + `struct ${name} *p_; int main(void){ return sizeof(struct ${name}); }\n`;
  return head + `${name} v_; int main(void){ return sizeof(v_); }\n`;
}
const reportBase = (h) => h.replace(/^\/+/, '');

async function main() {
  const base = await qcc(ARCHES[0].V, COMMON.map((h) => `#include <${h}>`).join('\n') + '\nint main(void){return 0;}\n', [], true);
  if (!base.ok) { console.error('baseline COMMON include set does not compile+link: ' + base.err); process.exit(3); }
  const result = { tool: 'portdoctor sdp-manifest', manifestVersion: 1, sdp: { product: 'QNX SDP 8.0', build: BUILD || null, qccTargets: [], gcc: null }, arches: {}, names: {}, headers: {}, libs: {}, flags: {}, notes: [] };
  try { const { stdout } = await run('x86_64-pc-nto-qnx8.0.0-gcc', ['--version']); result.sdp.gcc = stdout.split('\n')[0].replace(/\(QNX[^)]*\)/, '(QNX build id elided)'); } catch { /* */ }
  try { const r = await run('qcc', ['-V']).catch((e) => e); result.sdp.qccTargets = String(r.stderr || r.stdout).split('\n').map((l) => l.trim()).filter((l) => /^[\d.]+,gcc_/.test(l)).map((l) => l.replace(/\s.*$/, '')); } catch { /* */ }
  const incRoot = join(TARGET, 'usr', 'include');
  for (const arch of ARCHES) {
    console.error(`[${arch.name}] indexing headers`);
    const skip = Object.values(archInc).filter((d) => d !== archInc[arch.name]);
    const sharedIdx = indexHeaders(incRoot, skip);
    result.arches[arch.name] = { V: arch.V, headerFiles: sharedIdx.count, includeRoot: 'usr/include (shared) + usr/include/' + archInc[arch.name] };
    arch.hdr = sharedIdx;
    console.error(`[${arch.name}] reading dynamic symbols`);
    arch.syms = await symbols(arch);
  }
  // header probes + lib probes + name probes
  for (const arch of ARCHES) {
    console.error(`[${arch.name}] header probes`);
    const hres = await pool(HEADERS, 8, async (h) => {
      const exists = arch.hdr.present.has(h) || arch.hdr.present.has(archInc[arch.name] + '/' + h);
      const c = await qcc(arch.V, `#include <sys/types.h>\n#include <${h}>\nint main(void){return 0;}\n`, [], false);
      return { h, exists, compiles: c.ok, err: c.ok ? undefined : c.err };
    });
    for (const r of hres) { const e = (result.headers[r.h] ||= {}); e[arch.name] = { exists: r.exists, compiles: r.compiles, ...(r.err ? { firstError: r.err } : {}) }; }
    console.error(`[${arch.name}] library probes`);
    const lres = await pool(LIBS, 8, async (l) => {
      const files = [];
      for (const sub of ['lib', 'usr/lib']) { const dir = join(TARGET, arch.name, sub); if (existsSync(dir)) for (const f of readdirSync(dir)) if (new RegExp('^lib' + l.replace(/\+/g, '\\+') + '\\.(so|a)$').test(f)) files.push(f); }
      const c = await qcc(arch.V, `int main(void){return 0;}\n`, [`-l${l}`], true);
      return { l, files: [...new Set(files)], links: c.ok, err: c.ok ? undefined : c.err };
    });
    for (const r of lres) { const e = (result.libs[r.l] ||= {}); e[arch.name] = { fileInSdp: r.files.length > 0, files: r.files, linksWithQcc: r.links, ...(r.err ? { firstError: r.err } : {}) }; }
    console.error(`[${arch.name}] flag probes (${FLAGS.length})`);
    const fres = await pool(FLAGS, 8, async (fl) => {
      const c = await qcc(arch.V, '#include <stdio.h>\nint main(void){puts("x");return 0;}\n', [fl], true);
      return { fl, ok: c.ok, err: c.ok ? undefined : c.err };
    });
    for (const r of fres) { const e = (result.flags[r.fl] ||= {}); e[arch.name] = { linksWithQcc: r.ok, ...(r.err ? { firstError: r.err } : {}) }; }
    console.error(`[${arch.name}] name probes (${NAMES.length})`);
    const nres = await pool(NAMES, 8, async ([name, kind]) => {
      const found = arch.hdr.idx.get(name) || [];
      // prefer defining/declaring hits, public headers
      const rank = (x) => ({ define: 0, decl: 1, type: 1, typedef: 1, enum: 1, call: 3, cond: 4, mention: 3 }[x.how] ?? 3) + (/^_|fortify|_chk/.test(x.h.split('/').pop()) ? 2 : 0) + ((/^(devs|c\+\+|valgrind|VG|python3|openssl|libxml|CL|vulkan|GLES|EGL|KHR|ucl|lz4|lzma|lzo|libpng16|tss2|hw|io-sock|netpfil|net80211|netipsec)\//.test(x.h) || /^sys\/(libkern|systm)\.h/.test(x.h)) ? 3 : 0);
      const best = [...found].sort((a, b) => rank(a) - rank(b));
      const defHeaders = [...new Set(best.filter((x) => rank(x) <= 2).map((x) => x.h))].slice(0, 3);
      const incs = [...new Set([...COMMON, ...defHeaders.map((h) => h.replace(new RegExp('^' + archInc[arch.name] + '/'), ''))])];
      const attempt = async (gnu) => {
        const one = async (inc, libs) => qcc(arch.V, probeSrc(kind, name, inc, gnu), libs, kind === 'func');
        let r = await one(incs, []); let needsLib = null;
        if (!r.ok && defHeaders.length) { const r2 = await one(COMMON, []); if (r2.ok) r = r2; }
        if (!r.ok && kind === 'func' && /undefined reference/.test(r.err || '')) {
          const owners = [...(arch.syms.get(name) || [])].filter((l) => !/^(libasan|liblsan|libubsan|libc|libc\.a|libunbound)$/.test(l)).map((l) => '-l' + l.replace(/^lib/, ''));
          for (const libs of [['-lsocket', '-lm'], owners, [...owners, '-lsocket']]) { if (!libs.length) continue; const r3 = await one(incs, libs); if (r3.ok) { r = r3; needsLib = libs.join(' '); break; } }
        }
        return { ...r, needsLib };
      };
      const d = await attempt(''); const g = d.ok ? d : await attempt('gnu'); const x = g.ok ? g : await attempt('ext');
      const syms = [...(arch.syms.get(name) || [])].sort();
      const isPriv = (x) => rank(x) >= 3 && /^(devs|io-sock|c\+\+|valgrind|VG|unicode|libunwind|CL|vulkan|GLES|EGL|KHR|python3|openssl|libxml|ucl|lz4|lzma|lzo|libpng16|tss2|hw|netpfil|net80211|netipsec)[/]/.test(x.h) || /^sys\/(libkern|systm)\.h/.test(x.h) || /^(unicode|libunwind)/.test(x.h);
      return { name, kind, arch: arch.name, declaredIn: best.filter((x) => !isPriv(x)).slice(0, 5).map((x) => `${x.h}:${x.l} ${x.how}`), onlyInKernelPrivateHeaders: found.some(isPriv) && !best.some((x) => !isPriv(x) && rank(x) <= 2), usable: d.ok, usableWithGnuSource: g.ok && !d.ok, usableWithQnxExtensions: x.ok && !g.ok, needsLib: (d.ok ? d : g.ok ? g : x).needsLib || null, exportedBy: syms, err: x.ok ? undefined : d.err };
    });
    for (const r of nres) {
      const e = (result.names[r.name] ||= { kind: r.kind });
      const declared = r.declaredIn.some((s) => / (define|decl|type|typedef|enum)$/.test(s));
      let verdict;
      if (r.usable) verdict = 'present';
      else if (r.usableWithGnuSource || r.usableWithQnxExtensions) verdict = 'present-gated';
      else if (declared && r.kind === 'func' && r.exportedBy.length) verdict = 'declared-and-exported-but-probe-failed';
      else if (declared) verdict = /undeclared|incomplete type|unknown type|not defined/.test(r.err || '') ? 'declared-but-not-visible' : 'declared-not-linkable';
      else if (r.onlyInKernelPrivateHeaders) verdict = 'absent-from-user-headers';
      else if (r.exportedBy.length) verdict = 'symbol-only';
      else verdict = 'absent';
      e[arch.name] = { verdict, declaredIn: r.declaredIn, usable: r.usable, usableWithGnuSource: r.usableWithGnuSource, usableWithQnxExtensions: r.usableWithQnxExtensions, ...(r.needsLib ? { needsLib: r.needsLib } : {}), ...(r.onlyInKernelPrivateHeaders ? { onlyInKernelPrivateHeaders: true } : {}), exportedBy: r.exportedBy, ...(r.err ? { firstError: r.err } : {}) };
    }
  }
  for (const [n, e] of Object.entries(result.names)) {
    const vs = ARCHES.map((a) => e[a.name]?.verdict);
    e.verdict = vs.every((v) => v === vs[0]) ? vs[0] : 'mixed';
  }
  for (const [n, e] of Object.entries(result.flags)) { const vs = ARCHES.map((a) => e[a.name]?.linksWithQcc); e.verdict = vs.every(Boolean) ? 'present' : vs.every((v) => !v) ? 'absent' : 'mixed'; }
  for (const [n, e] of Object.entries(result.libs)) { const vs = ARCHES.map((a) => e[a.name]?.linksWithQcc); e.verdict = vs.every(Boolean) ? 'present' : vs.every((v) => !v) ? 'absent' : 'mixed'; }
  for (const [n, e] of Object.entries(result.headers)) { const vs = ARCHES.map((a) => e[a.name]?.compiles); e.verdict = vs.every(Boolean) ? 'present' : vs.every((v) => !v) ? 'absent' : 'mixed'; }
  result.notes.push('Probe = compile/link with qcc using the common POSIX headers plus up to three headers where the name is defined/declared; verdict absent means: not declared in the shared/arch include tree, not usable by that probe, not exported by any SDP .so/libc.a (dynamic symbols).',
    'Names that are declared but fail the probe may need a feature macro or another header; "present-gated" means usable only with _GNU_SOURCE. Header comments are stripped before the declaration search; #if branches are not evaluated, the compile probe is what decides usability.',
    'Link probe for functions takes the address of the function; linking uses qcc defaults (libc, libm? no: default libs only).');
  rmSync(TMP, { recursive: true, force: true });
  writeFileSync(OUT, JSON.stringify(result, null, 1) + '\n');
  const c = {}; for (const e of Object.values(result.names)) c[e.verdict] = (c[e.verdict] || 0) + 1;
  console.error(`done: ${Object.keys(result.names).length} names`, JSON.stringify(c), `headers ${Object.keys(result.headers).length} libs ${Object.keys(result.libs).length}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
