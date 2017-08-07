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

---

If you open a file descriptor for writing, but don't actually write anything, does the mtime change? What about atime?

Testing on it right now, if you open for reading, and don't read and close, nothing happens.

But opening it for write will auto truncate, because TRUNC is part of the write specifier.

If you open a write descriptor, each call to write will change the mtime and ctime. It's not just on the first write. That's really strange. It appears the time change must be a function of the write syscall. This is what causes such strange behaviour. Our writeSync behaves the same way, so this is correct then, our writeSync calls write on the iNode and changes the mtime and ctime. I guess the same thing happens with read, each read call should change the atime, but this is subject to optimisation.

Need to check if this applies to write streams as well, because if it does, then that means write streams and read streams need to update atime and mtime/ctime.

If a NodeJS buffer takes 2 GiB or more, it will error out. To avoid this, return ENOSPC. So a single file can only be 2 GiB. Although this may be platform dependent. On Linux 64 bit, it's 2 GiB on 6.9.5.

Symlink loops may have to be detected, but this means maintaining a list of symlinks that has been traversed. Or doing it just like the kernel with a limit on the number of symlinks to traverse. Note that on a live system it's actually impossible to detect dynamic symlink loops, where the loops may change. Since we are in a GC system, then we should be able to do this, just save the number of symlinks in a stack right?

On a live concurrently being mutated system, it's possible to not resolve symlinks except up to some arbitrary limiit. But in NodeJs this is not necessary, since there can only be 1 read or write at a time, so we should be able to just check if we are resolving to the same inode. Note that on Linux, the current limit is 40 resolutions. So we only need to keep track of symlink inodes right?

---

Symlink tracking has been implemented, unlike Linux, we keep track of each symlink inode, and if we revisit the symlink inode, that's when loop detection is emitted.

Access times and write times are modified on each call to syscall write or read. This is how file descripotors work underneath it all, every time a write or read is performed, this needs to apply.

However currently the times change according the iNode calls, read and write. This may make it complicated.

---

We need to resolve the parameter requirements for intermediate optional parameters. We can make use of some form of parameter handling function as the wrapper, and delegating to various workers. Also ES7 rest parameters can also be used.

Usually the idea is that the last parameter can be a callback. So this is the idea. So we just have to check if the last POSITION where position is dependent on the system. So writeAsync is very specific.

---

File descriptor positioning is important.

What we should do is make all writes work on top of file descriptor writes. This centralises the writing and reading part of it.

So let's specify this in the tests. That the FD positioning is correct.

Also I think we do need to specify the actually async versions directly due to the intermediate parameters.

There needs to be a quicker way to test calling parameters like `fs.open(path, flags, [,mode], callback)`. That's really just about making sure the 3rd parameter can be a callback.

Also we are still missing `mkdtemp` and `mkdtempSync`.

What if I can construct arguments like `[a, b, c], [a, b, c, d]` and the corresponding callback?

```
[
  {
    args: [a,b,c],
    call: (e) => {

    }
  },
  ...
]
```

So we could take this structure and, but is it any more efficient? Doesn't seem like it. Unlesss the callbacks are roughly the same.

This api is super complicated...

This is not efficient, there really should be an easy way to test optional parameters. Ooo es6 destructuring in function signatures. Cool.

---

Ok here to list the file descriptor positioning requirements.

readFileSync
writeFileSync
readSync
writeSync
appendFileSync

---

Test encoding? What encodings are available?

ascii
utf8
utf-8

Apparently encoding is one that is accepted by Buffer.
Bad encoding should be TypeError with `Unknown encoding: encoding`.

I think the idea is they convert to Buffer using the encoding variable, at all times, so if the encoding is incorrect, the Buffer class raises an error. Yep they just pass it directly to Buffer class, this is where the error is returned.

Apparently readSync specified with position DOES not move the file descriptor position.

```js
fd = fs.openSync('./testy', 'w+');
fs.writeSync(fd, 'abcdef');
buf = Buffer.alloc(3);
bytesRead = fs.readSync(fd, buf, 0, buf.length);
t.is(bytesRead, 0);
bytesRead = fs.readSync(fd, buf, 0, buf.length, 0);
t.is(bytesRead, 3);
t.deepEqual(buf, Buffer.from('abc'));
fs.writeSync(fd, 'ghi');
t.deepEqual(fs.readFileSync('./testy', 'utf8'), 'abcdefghi');
```

```js
fs.writeFileSync('./testy', 'abcdef');
fd = fs.openSync('./testy', 'r+');
buf = Buffer.alloc(3);
bytesRead = fs.readSync(fd, buf, 0, buf.length);
t.is(bytesRead, 3);
fs.writeSync(fd, 'ghi');
t.deepEqual(fs.readFileSync('./testy', 'utf8'), 'abcghi');
```

```js
fs.writeFileSync('./testy', 'abcdef');
fd = fs.openSync('./testy', 'r+');
buf = Buffer.alloc(3);
bytesRead = fs.readSync(fd, buf, 0, buf.length, 0);
t.is(bytesRead, 3);
fs.writeSync(fd, 'ghi');
t.deepEqual(fs.readFileSync('./testy', 'utf8'), 'ghidef);
```

```js
fs.writeFileSync('./testy', 'abcdef');
fd = fs.openSync('./testy', 'r+');
buf = Buffer.alloc(3);
bytesRead = fs.readSync(fd, buf, 0, buf.length, 3);
t.is(bytesRead, 3);
fs.writeSync(fd, 'ghi');
t.deepEqual(fs.readFileSync('./testy', 'utf8'), 'ghidef);
```

What this shows you is that positional writes never change the file descriptor position. The FD position is only changed on the null parameter for position. If position is specified, then the FD isn't changed right? What about the presence of 0.

There we go... so basically only the null parameter changes the file descriptor position. WTF!!!

Does this apply to writeSync? Does the position not matter there too?

Without a+ there's no way to read it as well.

```js
fs.writeFileSync('./testy', 'abc');
fd = fs.openSync('./testy', 'a+');
fs.writeSync(fd, 'def');
buf = Buffer.alloc(3);
bytesRead = fs.readSync(fd, buf, 0, buf.length);
t.is(bytesRead, 0);
fs.writeSync(fd, 'ghi');
t.deepEqual(fs.readFileSync('./testy', 'utf8'), 'abcdefghi');
```

```js
fs.writeFileSync('./testy', 'abcdef');
fd = fs.openSync('./testy', 'a+');
buf = Buffer.alloc(3);
bytesRead = fs.readSync(fd, buf, 0, buf.length);
t.is(bytesRead, 0);
t.deepEqual(buf, Buffer.from('abc'));
fs.writeSync(fd, 'ghi);
t.deepEqual(fs.readFileSync('./testy', 'utf8'), 'abcdefghi');
bytesRead = fs.readSync(fd, buf, 0, buf.length);
t.is(bytesRead, 0);
```

Also test if write sync at position changes the file descriptors.

```js
fd = fs.openSync('./testy', 'w+');
fs.writeSync(fd, 'abcdef');
fs.writeSync(fd, 'ghi', 0);
fs.writeSync(fd, 'jkl');
t.deepEqual(fs.readFileSync('./testy', 'utf8'), 'ghidefjkl');
```

---

Ok finally we need to change the design to be file descriptor centric.

Being file descripotor centric means inodes are not directly accessed except through the file descriptor for reading and writing. Well actually inodes may still get accessed through for metadata, and filesystem manipulation, but the writing and reading of the data within a file should be done through a file descriptor. So how do we do this. Perhaps the idea is that inodes can expose a file descriptor opening operation? The idea being is that file systems are still a tree of inodes, where the filesystem still navigates along that system. But for certain inodes they expose a file descriptor creation operation, that being of the ability that the file system can open file descriptor of to the inode's data. And all file reads and writes is mediated through this interface.

The only inodes with this ability is file. Whereas directory file descriptors are special, they exist as well but certain capabilities are limited.

The problem is that each fs instance has it's own instance of fdMgr, that's proper, and we should only have one. But if the inodes are going to give out fds, (specific inodes), then they need access to the fdMgr. Furthermore, a inode is not fully deleted when the inode is removed, if there's still a FD pointing to it. This is because the creation of a fd, produces a pointer to the inode, and even if the inode is deleted, the inode still exists in memory. This worked out nicely because of the fact that inodes once deleted, even if fd was still open, other new fd opening operations would not be able to see it in the filesystem tree unless other hardlinks existed.

Hang on, we actually give the inodeMgr to the construction of a inode. They are self-referential objects here. The inodes communicate to the inodemgr, the inodemgr keeps a reference to all inodes. Then is it so bad for inodes to also contain reference to fdmgr? It seems a bit weird.

```
fd = fs.openSync('./testy', 'r');

function openSync(path, mode) {

  inode = findINode(path);
  inode.getFd(this._fdMgr);

  // the idea being that by passing a reference the relevant fd manager
  // the inode will be able to contact that fdMgr and allocate a new fd number, and fd object
  // however the inode can also now wrap, or add callbacks the fd itself

}
```
