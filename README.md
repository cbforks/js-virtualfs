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

File descriptor numbers are unique when used, so the same number cannot be used for another file here. It is possible to keep opening the same file, it just increments the file descriptor. This means we need to keep a hastable of file descriptor numbers to files. File descriptors also maintain position and also permissions (opened for reading, writing, appending). If fds are not closed, they stay around. They are just passed around as numbers.
