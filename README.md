# VirtualFS

VirtualFS is a fork of https://github.com/webpack/memory-fs. It a virtual posix-like filesystem that runs completely in memory. It is intended to work in browsers and in NodeJS. For browser deployment, make sure to use browserify, the library will automatically load shims for browser usage.

It completely reworks the architecture to include:

* Proper stat metadata with MAC time handling
* Symlink support
* Hardlink support
* Virtual INodes
* Removal of all Windows path support
* Better compatibility with Node's FileSystem API

This package will be maintained as long as the Polykey project is maintained. All tests are passing in this fork.

---

Todo:

File descriptor support with open, close, read and write calls

File descriptors are local to each process. No need to handle parallel or concurrent access.

Each process has a file descriptor table.

So that means we just have to maintain 1 file descriptor table.

File descriptor numbers are unique when used, so the same number cannot be used for another file here. It is possible to keep opening the same file, it just increments the file descriptor. This means we need to keep a hastable of file descriptor numbers to files. File descriptors also maintain position and also permissions (opened for reading, writing, appending). If fds are not closed, they stay around. They are just passed around as numbers. So they don't have a special type, but we can extend from a number type.

Ok the filesystem maintains a table of file descriptor objects, indexed by anumber

It is possible to just open a file descriptor to a non-existent object. Oh wait it is possible to open it to a directory. WTF. Not a non-existent file.

Oh you can get a directory file descriptor. It needs O_RDONLY.

Using `O_RDONLY | O_DIRECTORY` requires only read and exec. While `O_DIRECTORY | O_PATH` only requires exec access. We don't care about modes but `O_PATH` doesn't seem available in the fs.constants. But this can be used by the OS, for me, I just won't test for it. The key point is that `O_RDONY` is the only one that should be used, while `O_PATH` doesn't make sense for virtual fs.

We need to respect `O_NOFOLLOW`, and `O_SYMLINK`. These are the constants related to opening file descriptors: https://nodejs.org/api/fs.html#fs_file_open_constants Which means that you can get file descriptors to symlinks as well. What is that for?

What is a directory file descriptor used for? It appears that the syscall `fdopendir` can be used to convert a directory file descriptor into a `DIR *` which is called a directory stream.

It appears a number of the syscalls that run on `at` calls uses directory file descriptors, creating operations that run relative to some directory. Which is quite weird, what is the use. This replaces the understanding that the current working directory of the process as the default directory for relative operations. The idea is to work through directory trees in a race free manner.

Openat allows you to lock down an entire directory path, resolving race conditions only once. Then safely open files relative to that path without worrying about race conditions. So wit hopenat, you first grab the file descriptor to the parent directory first, which will prevent other processes from modifying or removing that path. You can now use openat to open multiple files relative to the locked path safely, without worrying about the race conditions that opening absolute paths normally entails.

If the file is moved (same inode), the file handle remains open and can still be used to read and write. This must be tested in the node code.

It doesn't seem that nodejs has much code dealing with directory file descriptors, it's just possible to open it, but nothing to use it with, because there are no bindings to the new openat and other at calls.

Ok so what about file descriptors to symlinks? Ok I can see this now. You can't actually read on a directory, it returns EISDIR: illegal operation on a directory. So that should mean that also means we cannot read a directory. But... does this mean we can only perform the at operations on directories.

You can perform these on directory file descriptors:

```
fstatSync - Stat on directories
fchmodSync - Basically chmod on directories
fchownSync - Basically chown on directories
futimesSync - Uses Date objects or integers, but integers are not unixtime IN seconds, not in milliseconds that JS gives via (new Date).getTime() DAMN! Math.floor((new Date).getTime() / 1000)
fdatasyncSync - Does nothing
fsyncSync - Does nothing
```

Tests must be done on all these things.

Errors:

```
ftruncateSync - results in EINVAL
fread - results in EISDIR
fwrite - results in EBADF
readFileSync - results in EISDIR
writeFileSync - results in EBADF
```

Other than 'r', you cannot open file descriptor to DIRECTORY. It all returns EISDIR. Ok so openSync works with `fs.constants.O_RDONLY | fs.constants.O_DIRECTORY`.

Wait `O_SYMLINK` is not part of Linux, it's only part of nodejs, what the hell? Mac OSX has `O_SYMLINK`. Wait maybe we should only support POSIX minimum. Oh lol, I don't even have `O_SYMLINK` on my `fs.constants`. We do have `O_NOFOLLOW` which means if the pathname points to a symlink, then open fails with error ELOOP.

Linux has a thing called a Directory Stream. This is basically `DIR *`. You can go from file descriptor to directory stream via `fdopendir`. Then to go from directory stream to file descriptor you can use `dirfd`. But nothing seems to tell us if the file descriptor is of the right type?

Also linux has a file stream as well notated as `FILE *`. Both of these appear to be more specific versions of the generic file descriptor.

```
fileno :: FILE * -> FD
dirfd :: DIR * -> FD
fdopen :: FD -> FILE *
fdopendir :: FD -> DIR *
```

And then fcntl call can change and add read/write capabilities to an existing file descriptor, as long as the file originally supports the permissions right?

File descriptors save the state of their access mode which is read, write or read + write. Access modes of file descriptors can be changed but it is up to the implementation whether and what kind of changes are allowed. Changes to file descriptors is done via `fcntl`. It is possible to read what the access mode is via `fcntl(fd, F_GETFL)`. While for file streams you can do this with `freopen`.

* https://stackoverflow.com/questions/4637523/change-read-write-permissions-on-a-file-descriptor#comment5103679_4637523
* https://stackoverflow.com/questions/14514997/reopen-a-file-descriptor-with-another-access
* https://www.gnu.org/software/libc/manual/html_node/Streams-and-File-Descriptors.html
* https://stackoverflow.com/a/7026008/582917

So because we don't have problems with changing file descriptor access modes, we can do this easily.

Note that fcntl says that `F_SETFL` ignores file creation flags and file access flags. While `F_GETFL` is returning the file access flags and file status flags. `F_STEFL` does allow `O_APPEND` and `O_NOATIME` (relevant to us). I don't know but does `F_GETFL` return all flags created at the beginning?

File access mode and file status flags. So that's RDONLY, WRONLY, RDWR.

File creation flags:

CREAT
EXCL
NOCTTY
TRUNC
NOFOLLOW - probably true, haven't tested

These are not kept. Only file status flags and file access flags are kept in the flag property of the file descriptor. So we want to extract out the creation flags then?

File status flags

DIRECTORY (even when ignored, it is preserved)
APPEND
NOATIME

File access flags

RDONLY
WRONLY
RDWR


O_ACCMODE to test like `(flags & O_ACCMODE) == O_RDONLY`. That's in C. In other cases, you just need to do `flags === O_RDONLY` for testing read only.

So we should only be keeping the status and access flags around. Actually there's really no harm d one keeping the creation flags around. It's just in Linux they seem to have parsed out the flags.

```c
#include <stdio.h>
#include <unistd.h>
#include <fcntl.h>

int main () {

    // int fd = open("./.git", O_RDONLY);
    // int fd = open("./.git", O_RDONLY | O_DIRECTORY);
    int fd = open("./testdir", O_RDONLY | O_DIRECTORY | O_CREAT | O_EXCL, 0644);

    if (fd == -1) {
        perror("open");
    }
    printf("FD: %u\n", fd);
    int flags = fcntl(fd, F_GETFL);
    if ((flags & O_ACCMODE) == O_RDONLY) {
        printf("O_RDONLY\n");
    }
    if ((flags & O_ACCMODE) == O_WRONLY) {
        printf("O_WRONLY\n");
    }
    if ((flags & O_ACCMODE) == O_RDWR) {
        printf("O_RDWR\n");
    }
    if (flags & O_DIRECTORY) {
        printf("O_DIRECTORY\n");
    }
    if (flags & O_CREAT) {
        printf("O_CREAT\n");
    }
    if (flags & O_EXCL) {
        printf("O_EXCL\n");
    }
    printf("F_GETFL: %u\n", flags);
    return 1;

}
```

Should definitely add a gist about this.

---

If you open a file descriptor for writing, but don't actually write anything, does the mtime change? What about atime?

Testing on it right now, if you open for reading, and don't read and close, nothing happens.

But opening it for write will auto truncate, because TRUNC is part of the write specifier.

If you open a write descriptor, each call to write will change the mtime and ctime. It's not just on the first write. That's really strange. It appears the time change must be a function of the write syscall. This is what causes such strange behaviour. Our writeSync behaves the same way, so this is correct then, our writeSync calls write on the iNode and changes the mtime and ctime. I guess the same thing happens with read, each read call should change the atime, but this is subject to optimisation.
