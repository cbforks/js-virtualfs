/** @module VirtualFS */

import 'setimmediate';
import { Buffer } from 'buffer';
import path from 'path';
import { Readable as ReadableStream, Writable as WritableStream } from 'readable-stream';
import errno from 'errno';
import clone from 'component-clone';
import cloneBuffer from 'clone-buffer';
import constants from './constants';
import Stat from './Stat';
import { File, Directory, Symlink, INodeManager } from './INodes';
import { FileDescriptor, FileDescriptorManager } from './FileDescriptors';

class VirtualFSError extends Error {

  /**
   * Creates an Error object simulating Node's fs errors
   * @param {{errno: number, code: string, description: string}} errorSys
   * @param {string|string[]} paths - Paths used when this error is thrown
   * @returns {VirtualFSError}
   */
  constructor (errorSys, paths) {
    let message = errorSys.code + ': ' + errorSys.description;
    if (paths) {
      paths = (Array.isArray(paths)) ? paths : [paths];
      message = ', ' + paths.map((v) => "'" + v + "'").join(' -> ');
    } else {
      paths = '';
    }
    super(message);
    this.code = errorSys.code;
    this.errno = errorSys.errno;
    this.paths = paths;
  }

}

class VirtualFS {

  /**
   * Constructs an FS object simulating Node's fs object
   */
  constructor () {
    this._inodeMgr = new INodeManager;
    this._fdMgr = new FileDescriptorManager;
    let rootIndex = this._inodeMgr.createINode(Directory, {});
    this._root = this._inodeMgr.getINode(rootIndex);
    this.constants = constants;
  }

  _maybeCallback (callback) {
    return typeof callback === 'function'
      ? callback
      : ((err) => { if (err) throw err; });
  }

  _callAsync (syncFn, args, successCall, failCall) {
    try {
      const result = syncFn(...args);
      result = typeof result === 'undefined' ? null : result;
      setImmediate(() => {
        successCall(result);
      });
    } catch (e) {
      setImmediate(() => {
        failCall(e);
      });
    }
    return;
  }

  /**
   * Parses and extracts the first path segment
   * @param {string} pathS
   * @returns {{segment: string, rest: string}}
   */
  _parsePath (pathS) {
    let matches = pathS.match(/^([\s\S]*?)(?:\/+|$)([\s\S]*)/);
    let segment = matches[1] || '';
    let rest = matches[2] || '';
    return {
      segment: segment,
      rest: rest
    };
  }

  /**
   * Navigates the filesystem tree from root
   * You can interpret the results like:
   *   target && !name  => dir is at /
   *   !target && !name => not found within a pathS segment
   *   !target && name  => empty target at pathS
   * @private
   * @param {string} pathS
   * @param {boolean} [resolveLastLink=true] - If true, resolve the target symlink
   * @returns {{dir: Directory, target: File|Directory|Symlink, name: string, remaining: string}}
   * @throws {VirtualFSError|TypeError} Will throw ENOENT if pathS is empty, should not throw TypeError
   */
  _navigate (pathS, resolveLastLink=true, activeSymlinks=(new Set)) {
    if (!pathS) {
      throw new VirtualFSError(errno.code.ENOENT, pathS);
    }
    // at root consider that: '/a', 'a', '/a', './a', '../a' are all the same
    // so we canonicalise all of these to just 'a'
    pathS = pathS.replace(/^\.{1,2}\/|\/+/, '');
    // if it is empty now, this means there was just /
    if (pathS === '') {
      return {
        dir: this._root,
        target: this._root,
        name: null,
        remaining: ''
      };
    }
    return this._navigateFrom(this._root, pathS, resolveLastLink, activeSymlinks);
  }

  /**
   * Navigates the filesystem tree from a given directory
   * @private
   * @param {Directory} curdir
   * @param {string} pathS
   * @param {boolean} resolveLastLink
   * @returns {{dir: Directory, target: File|Directory|Symlink, name: string, remaining: string}}
   * @throws {VirtualFSError|TypeError} Will throw ENOENT if pathS is empty, should not throw TypeError
   */
  _navigateFrom (curdir, pathS, resolveLastLink=true, activeSymlinks=(new Set)) {
    if (!pathS) {
      throw new VirtualFSError(errno.code.ENOENT, pathS);
    }
    let parse = this._parsePath(pathS);
    let target = curdir.getEntry(parse.segment);
    switch (true) {
    case target instanceof File:
      if (!parse.rest) {
        return {
          dir: curdir,
          target: target,
          name: parse.segment,
          remaining: parse.rest
        };
      }
      return {
        dir: curdir,
        target: null,
        name: null,
        remaining: parse.rest
      };
    case target instanceof Directory:
      if (!parse.rest) {
        return {
          dir: curdir,
          target: target,
          name: parse.segment,
          remaining: parse.rest
        };
      }
      return this._navigateFrom(target, parse.rest, resolveLastLink, activeSymlinks);
    case target instanceof Symlink:
      if (!resolveLastLink && !parse.rest) {
        return {
          dir: curdir,
          target: target,
          name: parse.segment,
          remaining: parse.rest
        };
      }
      if (activeSymlinks.has(target)) {
        throw new VirtualFSError(errno.code.ELOOP, pathS);
      } else {
        activeSymlinks.add(target);
      }
      let symlink = path.posix.join(target.getLink(), parse.rest);
      if (symlink[0] === '/') {
        return this._navigate(symlink, resolveLastLink, activeSymlinks);
      } else {
        return this._navigateFrom(curdir, symlink, resolveLastLink, activeSymlinks);
      }
    case typeof target === 'undefined':
      return {
        dir: curdir,
        target: null,
        name: parse.segment,
        remaining: parse.rest
      };
    default:
      throw new TypeError('Non-exhaustive pattern matching');
    }
  }

  access (pathS, ...args) {
    let cbIndex = args.findIndex((arg) => typeof arg === 'function');
    const callback = this._maybeCallback(args[cbIndex]);
    cbIndex = (cbIndex >= 0) ? cbIndex : args.length;
    this._callAsync(
      this.accessSync.bind(this),
      [pathS, ...args.slice(0, cbIndex)],
      callback,
      callback
    );
    return;
  }

  accessSync (pathS, mode=this.constants.F_OK) {
    const target = this._navigate(pathS, true).target;
    if (!target) {
      throw new VirtualFSError(errno.code.ENOENT, pathS);
    }
    const targetMode = target.getMetadata().mode;
    // our filesystem has no notion of users, groups and other
    // so we just directly map the access flags to user permissions flags
    let userMode = 0;
    switch (mode) {
    case this.constants.R_OK:
      userMode |= this.constants.S_IRUSR;
    case this.constants.W_OK:
      userMode |= this.constants.S_IWUSR;
    case this.constants.X_OK:
      userMode |= this.constants.S_IXUSR;
    }
    if ((targetMode & userMode) !== userMode) {
      throw new VirtualFSError(errno.code.EACCES, pathS);
    }
  }

  appendFile (file, data, ...args) {
    let cbIndex = args.findIndex((arg) => typeof arg === 'function');
    const callback = this._maybeCallback(args[cbIndex]);
    cbIndex = (cbIndex >= 0) ? cbIndex : args.length;
    this._callAsync(
      this.appendFileSync.bind(this),
      [file, data, ...args.slice(0, cbIndex)],
      callback,
      callback
    );
    return;
  }

  appendFileSync (file, data='undefined', options={encoding:'utf8',flag:'a'}) {
    if (typeof options === 'string') {
      options = { encoding: options };
    }
    if (!options.flag) {
      options.flag = 'a';
    }
    if (!(data instanceof Buffer)) {
      data = Buffer.from(data.toString(), options.encoding);
    }
    let fdIndex;
    let fd;
    if (typeof file === 'string') {
      fdIndex = this.openSync(file, options.flag);
      fd = this._fdMgr.getFd(fdIndex);
    } else if (typeof file === 'number') {
      fd = this._fdMgr.getFd(file);
    } else {
      throw TypeError('file must be a string or number');
    }
    if (!fd) {
      throw new VirtualFSError(errno.code.EBADF, 'appendFile');
    }
    try {
      fd.write(data, null, constants.O_APPEND);
    } catch (e) {
      if (e instanceof RangeError) {
        throw new VirtualFSError(errno.code.ENOSPC, 'appendFile');
      }
      throw e;
    }
    if (fdIndex) this.closeSync(fdIndex);
    return;
  }

  chmod (pathS, mode, callback) {
    callback = this._maybeCallback(callback);
    this._callAsync(
      this.chmodSync.bind(this),
      [pathS, mode],
      callback,
      callback
    );
    return;
  }

  chmodSync (pathS, mode) {
    if (!this._navigate(pathS, true).target) {
      throw new VirtualFSError(errno.code.ENOENT, pathS);
    }
    return;
  }

  chown (pathS, uid, gid, callback) {
    callback = this._maybeCallback(callback);
    this._callAsync(
      this.chownSync.bind(this),
      [pathS, uid, gid],
      callback,
      callback
    );
    return;
  }

  chownSync (pathS, uid, gid) {
    if (!this._navigate(pathS, true).target) {
      throw new VirtualFSError(errno.code.ENOENT, pathS);
    }
    return;
  }

  close (fdIndex, callback) {
    callback = this._maybeCallback(callback);
    this._callAsync(
      this.closeSync.bind(this),
      [fdIndex],
      callback,
      callback
    );
    return;
  }

  closeSync (fdIndex) {
    if (!this._fdMgr.getFd(fdIndex)) {
      throw new VirtualFSError(errno.code.EBADF, 'close');
    }
    this._fdMgr.deleteFd(fd);
    return;
  }

  // todo: review this code
  createReadStream (pathS, options) {
    let stream = new ReadableStream();
    let done = false;
    let data;
    try {
      data = this.readFileSync(pathS);
    } catch (e) {
      stream._read = () => {
        if (done) {
          return;
        }
        done = true;
        this.emit('error', e);
        this.push(null);
      };
      return stream;
    }
    options = options || {};
    options.start = options.start || 0;
    options.end = options.end || data.length;
    stream._read = function() {
      if (done) return;
      done = true;
      this.push(data.slice(options.start, options.end));
      this.push(null);
    };
    return stream;
  }

  // todo: review this code
  createWriteStream (pathS, options) {
    let stream = new WritableStream();
    try {
      // Zero the file and make sure it is writable
      this.writeFileSync(pathS, Buffer.alloc(0));
    } catch(e) {
      // This or setImmediate?
      stream.once('prefinish', function() {
        stream.emit('error', e);
      });
      return stream;
    }
    let bl = [], len = 0;
    stream._write = (chunk, encoding, callback) => {
      bl.push(chunk);
      len += chunk.length;
      this.writeFile(pathS, Buffer.concat(bl, len), callback);
    };
    return stream;
  }

  exists(pathS, callback) {
    callback = this._maybeCallback(callback);
    this._callAsync(
      this.existsSync.bind(this),
      [pathS],
      callback,
      callback
    );
    return;
  }

  existsSync (pathS) {
    try {
      return !!(this._navigate(pathS, true).target);
    } catch (e) {
      return false;
    }
  }

  fchmod (fdIndex, mode, callback) {
    callback = this._maybeCallback(callback);
    this._callAsync(
      this.fchmodSync.bind(this),
      [fdIndex, mode],
      callback,
      callback
    );
    return;
  }

  fchmodSync (fdIndex, mode) {
    if (!this._fdMgr.getFd(fdIndex)) {
      throw new VirtualFSError(errno.code.EBADF, 'fchmod');
    }
    return;
  }

  fchown (fdIndex, uid, gid, callback) {
    callback = this._maybeCallback(callback);
    this._callAsync(
      this.fchmodSync.bind(this),
      [fdIndex, uid, gid],
      callback,
      callback
    );
    return;
  }

  fchownSync (fdIndex, uid, gid) {
    if (!this._fdMgr.getFd(fdIndex)) {
      throw new VirtualFSError(errno.code.EBADF, 'fchown');
    }
    return;
  }

  fdatasync (fdIndex, callback) {
    callback = this._maybeCallback(callback);
    this._callAsync(
      this.fchmodSync.bind(this),
      [fdIndex],
      callback,
      callback
    );
    return;
  }

  fdatasyncSync (fdIndex) {
    if (!this._fdMgr.getFd(fdIndex)) {
      throw new VirtualFSError(errno.code.EBADF, 'fdatasync');
    }
    return;
  }

  fstat (fdIndex, callback) {
    callback = this._maybeCallback(callback);
    this._callAsync(
      this.fstatSync.bind(this),
      [fdIndex],
      callback,
      callback
    );
    return;
  }

  fstatSync (fdIndex) {
    const fd = this._fdMgr.getFd(fdIndex);
    if (!fd) {
      throw new VirtualFSError(errno.code.EBADF, 'fstat');
    }
    return new Stat(clone(fd.getINode().getMetadata()));
  }

  fsync (fdIndex, callback) {
    callback = this._maybeCallback(callback);
    this._callAsync(
      this.fsyncSync.bind(this),
      [fdIndex],
      callback,
      callback
    );
    return;
  }

  fsyncSync (fdIndex) {
    if (!this._fdMgr.getFd(fdIndex)) {
      throw new VirtualFSError(errno.code.EBADF, 'fsync');
    }
    return;
  }

  ftruncate (fdIndex, ...args) {
    let cbIndex = args.findIndex((arg) => typeof arg === 'function');
    const callback = this._maybeCallback(args[cbIndex]);
    cbIndex = (cbIndex >= 0) ? cbIndex : args.length;
    this._callAsync(
      this.ftruncateSync.bind(this),
      [fdIndex, ...args.slice(0, cbIndex)],
      callback,
      callback
    );
    return;
  }

  ftruncateSync (fdIndex, len=0) {
    const fd = this._fdMgr.getFd(fdIndex);
    if (!fd) {
      throw new VirtualFSError(errno.code.EBADF, 'ftruncate');
    }
    const flags = fd.getFlags();
    if (!(flags & (constants.O_WRONLY | constants.O_RDWR))) {
      throw new VirtualFSError(errno.code.EINVAL, 'ftruncate');
    }
    fd.truncate(len);
    return;
  }

  futimes (fdIndex, atime, mtime, callback) {
    const callback = this._maybeCallback(callback);
    this._callAsync(
      this.futimesSync.bind(this),
      [fdIndex, atime, mtime],
      callback,
      callback
    );
    return;
  }

  futimesSync (fdIndex, atime, mtime) {
    const fd = this._fdMgr.getFd(fdIndex);
    if (!fd) {
      throw new VirtualFSError(errno.code.EBADF, 'futimes');
    }
    const metadata = fd.getINode().getMetadata();
    const newAtime;
    if (typeof atime === 'number') {
      newAtime = new Date(atime * 1000);
    } else if (atime instanceof Date) {
      newAtime = atime;
    } else {
      throw TypeError('atime and mtime must be dates or unixtime in seconds');
    }
    const newMtime;
    if (typeof mtime === 'number') {
      newMtime = new Date(mtime * 1000);
    } else if (mtime instanceof Date) {
      newMtime = mtime;
    } else {
      throw TypeError('atime and mtime must be dates or unixtime in seconds');
    }
    metadata.atime = newAtime;
    metadata.mtime = newMtime;
    return;
  }

  lchmod (pathS, mode, callback) {
    const callback = this._maybeCallback(callback);
    this._callAsync(
      this.lchmodSync.bind(this),
      [pathS, mode],
      callback,
      callback
    );
    return;
  }

  lchmodSync (pathS, mode) {
    if (!this._navigate(pathS, false).target) {
      throw new VirtualFSError(errno.code.ENOENT, pathS);
    }
    return;
  }

  lchown (pathS, uid, gid, callback) {
    const callback = this._maybeCallback(callback);
    this._callAsync(
      this.lchownSync.bind(this),
      [pathS, uid, gid],
      () => callback(null),
      callback
    );
    return;
  }

  lchownSync (pathS, uid, gid) {
    if (!this._navigate(pathS, false).target) {
      throw new VirtualFSError(errno.code.ENOENT, pathS);
    }
    return;
  }

  link (target, pathS, callback) {
    const callback = this._maybeCallback(callback);
    this._callAsync(
      this.linkSync.bind(this),
      [target, pathS],
      callback,
      callback
    );
    return;
  }

  linkSync (target, pathS) {
    let navigatedTarget;
    let navigatedSource;
    try {
      navigatedTarget = this._navigate(target, false);
      navigatedSource = this._navigate(pathS, false);
    } catch (e) {
      if (e instanceof VirtualFSError) {
        throw new VirtualFSError(errno.code.ENOENT, [target, pathS]);
      }
    }
    if (!navigatedTarget.target) {
      throw new VirtualFSError(errno.code.ENOENT, [target, pathS]);
    }
    if (navigatedTarget.target instanceof Directory) {
      throw new VirtualFSError(errno.code.EPERM, [target, pathS]);
    }
    if (!navigatedSource.target && !navigatedSource.name) {
      throw new VirtualFSError(errno.code.ENOENT, [target, pathS]);
    }
    if (!navigatedSource.target) {
      let index = navigatedTarget.dir.getEntryIndex(navigatedTarget.name);
      navigatedSource.dir.addEntry(navigatedSource.name, index);
      this._inodeMgr.linkINode(index);
    } else {
      throw new VirtualFSError(errno.code.EEXIST, [target, pathS]);
    }
    return;
  }

  lstat (pathS, callback) {
    const callback = this._maybeCallback(callback);
    this._callAsync(
      this.lstatSync.bind(this),
      [pathS],
      (stat) => callback(null, stat),
      callback
    );
    return;
  }

  lstatSync (pathS) {
    const target = this._navigate(pathS, false).target;
    if (target) {
      return new Stat(clone(target.getMetadata()));
    } else {
      throw new VirtualFSError(errno.code.ENOENT, pathS);
    }
  }

  mkdir (pathS, ...args) {
    let cbIndex = args.findIndex((arg) => typeof arg === 'function');
    const callback = this._maybeCallback(args[cbIndex]);
    cbIndex = (cbIndex >= 0) ? cbIndex : args.length;
    this._callAsync(
      this.mkdirSync.bind(this),
      [pathS, ...args.slice(0, cbIndex)],
      callback,
      callback
    );
    return;
  }

  mkdirSync (pathS, mode) {
    let navigated = this._navigate(pathS, true);
    if (!navigated.target && !navigated.name) {
      throw new VirtualFSError(errno.code.ENOENT, pathS);
    } else if (!navigated.target && navigated.remaining) {
      throw new VirtualFSError(errno.code.ENOENT, pathS);
    } else if (!navigated.target) {
      let index = this._inodeMgr.createINode(
        Directory,
        { parent: navigated.dir.getEntryIndex('.') }
      );
      navigated.dir.addEntry(navigated.name, index);
    } else if (!(navigated.target instanceof Directory)) {
      throw new VirtualFSError(errno.code.ENOTDIR, pathS);
    } else {
      throw new VirtualFSError(errno.code.EEXIST, pathS);
    }
    return;
  }

  mkdirp (pathS, ...args) {
    let cbIndex = args.findIndex((arg) => typeof arg === 'function');
    const callback = this._maybeCallback(args[cbIndex]);
    cbIndex = (cbIndex >= 0) ? cbIndex : args.length;
    this._callAsync(
      this.mkdirpSync.bind(this),
      [pathS, ...args.slice(0, cbIndex)],
      callback,
      callback
    );
    return;
  }

  mkdirpSync (pathS, mode) {
    let current = null;
    let navigated = this._navigate(pathS, true);
    while (true) {
      if (!navigated.target && !navigated.name) {
        throw new VirtualFSError(errno.code.ENOTDIR, pathS);
      } else if (!navigated.target) {
        let index = this._inodeMgr.createINode(
          Directory,
          { parent: navigated.dir.getEntryIndex('.') }
        );
        navigated.dir.addEntry(navigated.name, index);
        if (navigated.remaining) {
          current = this._inodeMgr.getINode(index);
          navigated = this._navigateFrom(current, navigated.remaining, true);
        } else {
          break;
        }
      } else if (!(navigated.target instanceof Directory)) {
        throw new VirtualFSError(errno.code.ENOTDIR, pathS);
      } else {
        break;
      }
    }
    return;
  }

  mkdtemp () {

  }

  mkdtempSync () {

  }

  open (pathS, flags, ...args) {
    let cbIndex = args.findIndex((arg) => typeof arg === 'function');
    const callback = this._maybeCallback(args[cbIndex]);
    cbIndex = (cbIndex >= 0) ? cbIndex : args.length;
    this._callAsync(
      this.openSync.bind(this),
      [pathS, flags, ...args.slice(0, cbIndex)],
      (fdIndex) => callback(null, fdIndex),
      callback
    );
    return;
  }

  openSync (pathS, flags, mode) {
    if (typeof flags === 'string') {
      switch(flags) {
      case 'r':
        flags = constants.O_RDONLY;
        break;
      case 'r+':
      case 'rs+':
        flags = constants.O_RDWR;
        break;
      case 'w':
        flags = (constants.O_WRONLY |
                 constants.O_CREAT  |
                 constants.O_TRUNC);
        break;
      case 'wx':
        flags = (constants.O_WRONLY |
                 constants.O_CREAT  |
                 constants.O_TRUNC  |
                 constants.O_EXCL);
        break;
      case 'w+':
        flags = (constants.O_RDWR  |
                 constants.O_CREAT |
                 constants.O_TRUNC);
        break;
      case 'wx+':
        flags = (constants.O_RDWR  |
                 constants.O_CREAT |
                 constants.O_TRUNC |
                 constants.O_EXCL);
        break;
      case 'a':
        flags = (constants.O_WRONLY |
                 constants.O_APPEND |
                 constants.O_CREAT);
        break;
      case 'ax':
        flags = (constants.O_WRONLY |
                 constants.O_APPEND |
                 constants.O_CREAT  |
                 constants.O_EXCL);
        break;
      case 'a+':
        flags = (constants.O_RDWR   |
                 constants.O_APPEND |
                 constants.O_CREAT);
        break;
      case 'ax+':
        flags = (constants.O_RDWR   |
                 constants.O_APPEND |
                 constants.O_CREAT  |
                 constants.O_EXCL);
        break;
      default:
        throw new TypeError('Unknown file open flag: ' + flags);
      }
    }
    if (typeof flags !== 'number') {
      throw new TypeError('Unknown file open flag: ' + flags);
    }
    let navigated = this._navigate(pathS, false);
    if (navigated.target instanceof Symlink) {
      // cannot be symlink if O_NOFOLLOW
      if (flags & constants.O_NOFOLLOW) {
        throw new VirtualFSError(errno.code.ELOOP, pathS);
      }
      // cannot create exclusively if symlink
      if (flags & constants.O_CREAT && flags & constants.O_EXCL) {
        throw new VirtualFSError(errno.code.EEXIST, pathS);
      }
      navigated = this._navigateFrom(
        navigated.dir,
        navigated.name + navigated.remaining,
        true
      );
    }
    // directory component missing
    if (!navigated.target && !navigated.name) {
      throw new VirtualFSError(errno.code.ENOENT, pathS);
    }
    let target = navigated.target;
    // cannot be missing unless O_CREAT
    if (!target) {
      if (flags & constants.O_CREAT) {
        // always creates a regular file
        const index = this._inodeMgr.createINode(File, { data: Buffer.alloc(0) });
        navigated.dir.addEntry(navigated.name, index);
        target = this._inodeMgr.getINode(index);
      } else {
        throw new VirtualFSError(errno.code.ENOENT, pathS);
      }
    } else {
      // target already exists cannot be created exclusively
      if ((flags & constants.O_CREAT) && (flags & constants.O_EXCL)) {
        throw new VirtualFSError(errno.code.EEXIST, pathS);
      }
      // cannot be directory if write capabilities are requested
      if ((target instanceof Directory) &&
          (flags & (constants.O_WRONLY | flags & constants.O_RDWR)))
      {
        throw new VirtualFSError(errno.code.EISDIR, pathS);
      }
      // must be directory if O_DIRECTORY
      if ((flags & constants.O_DIRECTORY) && !(target instanceof Directory)) {
        throw new VirtualFSError(errno.code.ENOTDIR, pathS);
      }
      // must truncate a file if O_TRUNC
      if ((flags & constants.O_TRUNC) &&
          (target instanceof File) &&
          (flags & (constants.O_WRONLY | constants.O_RDWR)))
      {
        target.setData(Buffer.alloc(0));
      }
    }
    return this._fdMgr.createFd(target, flags).index;
  }

  read (fdIndex, buffer, ...args) {
    let cbIndex = args.findIndex((arg) => typeof arg === 'function');
    const callback = this._maybeCallback(args[cbIndex]);
    cbIndex = (cbIndex >= 0) ? cbIndex : args.length;
    this._callAsync(
      this.readSync.bind(this),
      [fdIndex, buffer, ...args.slice(0, cbIndex)],
      (bytesRead) => callback(null, bytesRead, buffer),
      callback
    );
    return;
  }

  readSync (fdIndex, buffer, offset=0, length=0, position=null) {
    const fd = this._fdMgr.getFd(fdIndex);
    if (!fd) {
      throw new VirtualFSError(errno.code.EBADF, 'read');
    }
    if (position < 0) {
      throw new VirtualFSError(errno.code.EINVAL, 'read');
    }
    if (fd.getINode().getMetadata().isDirectory()) {
      throw new VirtualFSError(errno.code.EISDIR, 'read');
    }
    const flags = fd.getFlags();
    if (flags !== constants.O_RDONLY && !(flags & constants.O_RDWR)) {
      throw new VirtualFSError(errno.code.EBADF, 'read');
    }
    if (offset < 0 || offset > buffer.length) {
      throw new RangeError('Offset is out of bounds');
    }
    if (length < 0 || length > buffer.length) {
      throw new RangeError('Length extends beyond buffer');
    }
    buffer = buffer.slice(offset, length);
    return fd.read(buffer, position);
  }

  readdir (pathS, ...args) {
    let cbIndex = args.findIndex((arg) => typeof arg === 'function');
    const callback = this._maybeCallback(args[cbIndex]);
    cbIndex = (cbIndex >= 0) ? cbIndex : args.length;
    this._callAsync(
      this.readdirSync.bind(this),
      [pathS, ...args.slice(0, cbIndex)],
      (files) => callback(null, files),
      callback
    );
    return;
  }

  readdirSync (pathS, options={encoding:'utf8'}) {
    if (typeof options === 'string') {
      options = { encoding: options };
    }
    let navigated = this._navigate(pathS, true);
    if (!navigated.target) {
      throw new VirtualFSError(errno.code.ENOENT, pathS);
    }
    if (navigated.target instanceof Symlink) {
      throw new VirtualFSError(errno.code.ENOTDIR, pathS);
    }
    return Object.keys(navigated.target.getEntries())
      .filter((v) => v !== '.' && v !== '..')
      .map((name) => {
        if (options.encoding === 'buffer') {
          return Buffer.from(name);
        } else {
          return Buffer.from(name).toString(options.encoding);
        }
      });
  }

  readFile (file, ...args) {
    let cbIndex = args.findIndex((arg) => typeof arg === 'function');
    const callback = this._maybeCallback(args[cbIndex]);
    cbIndex = (cbIndex >= 0) ? cbIndex : args.length;
    this._callAsync(
      this.readFileSync.bind(this),
      [file, ...args.slice(0, cbIndex)],
      (data) => callback(null, data),
      callback
    );
    return;
  }

  readFileSync (file, options={encoding:null,flag:'r'}) {
    if (typeof options === 'string') {
      options = { encoding: options };
    }
    if (!options.flag) {
      options.flag = 'r';
    }
    let fdIndex;
    let fd;
    if (typeof file === 'string') {
      fdIndex = this.openSync(file, options.flag);
      fd = this._fdMgr.getFd(fdIndex);
    } else if (typeof file === 'number') {
      fd = this._fdMgr.getFd(file);
    } else {
      throw TypeError('file must be a string or number');
    }
    if (!fd) {
      throw new VirtualFSError(errno.code.EBADF, 'readFile');
    }
    if (fd.getINode().getMetadata().isDirectory()) {
      throw new VirtualFSError(errno.code.EISDIR, 'readFile');
    }
    let buffer;
    let bufferTotal = Buffer.alloc(0);
    let bytesRead = 0;
    do {
      buffer = Buffer.alloc(4096);
      bytesRead = fd.read(buffer);
      bufferTotal = Buffer.concat(
        [bufferTotal, buffer],
        bufferTotal.length + bytesRead
      );
    } while (bytesRead === buffer.length);
    if (fdIndex) this.closeSync(fdIndex);
    return options.encoding ? bufferTotal.toString(encoding) : buffer;
  }

  readlink (pathS, ...args) {
    let cbIndex = args.findIndex((arg) => typeof arg === 'function');
    const callback = this._maybeCallback(args[cbIndex]);
    cbIndex = (cbIndex >= 0) ? cbIndex : args.length;
    this._callAsync(
      this.readlinkSync.bind(this),
      [pathS, ...args.slice(0, cbIndex)],
      (linkString) => callback(null, linkString),
      callback
    );
    return;
  }

  readlinkSync (pathS, options={encoding:'utf8'}) {
    if (typeof options === 'string') {
      options = { encoding: options };
    }
    let target = this._navigate(pathS, false).target;
    if (!target) {
      throw new VirtualFSError(errno.code.ENOENT, pathS);
    }
    if (!(target instanceof Symlink)) {
      throw new VirtualFSError(errno.code.EINVAL, pathS);
    }
    const link = target.getLink();
    if (options.encoding === 'buffer') {
      return Buffer.from(link);
    } else {
      return Buffer.from(link).toString(options.encoding);
    }
  }

  realpath () {

  }

  realpathSync () {

  }

  rename (oldPathS, newPathS, callback) {
    callback = this._maybeCallback(callback);
    this._callAsync(
      this.renameSync.bind(this),
      [oldPathS, newPathS],
      callback,
      callback
    );
    return;
  }

  renameSync(oldPathS, newPathS) {
    let navigatedSource = this._navigate(oldPathS, false);
    let navigatedTarget = this._navigate(newPathS, false);
    // neither oldPathS nor newPathS can point to root
    if (navigatedSource.target === this._root ||
        navigatedTarget.target === this._root)
    {
      throw new VirtualFSError(errno.code.EBUSY, [oldPathS, newPathS]);
    }
    // source must resolve to something
    // both source and target must resolve intermediate path segments
    if (!navigatedSource.target || (!navigatedTarget.target && !navigatedTarget.name)) {
      throw new VirtualFSError(errno.code.ENOENT, [oldPathS, newPathS]);
    }
    // if source is file, target must not be a directory
    if (navigatedSource.target instanceof File &&
        navigatedTarget.target instanceof Directory)
    {
      throw new VirtualFSError(errno.code.EISDIR, [oldPathS, newPathS]);
    }
    // if source is a directory, target must be a directory (if it exists)
    if (navigatedSource.target instanceof Directory &&
        navigatedTarget.target &&
        !(navigatedTarget.target instanceof Directory))
    {
      throw new VirtualFSError(errno.code.ENOTDIR, [oldPathS, newPathS]);
    }
    // if the target directory contains elements this cannot be done
    if (navigatedTarget.target instanceof Directory &&
        Object.keys(navigatedTarget.target.getEntries()) - 2)
    {
      throw new VirtualFSError(errno.code.ENOTEMPTY, [oldPathS, newPathS]);
    }
    // if they are in the same directory, it is simple rename
    if (navigatedSource.dir === navigatedTarget.dir) {
      navigatedSource.dir.renameEntry(navigatedSource.name, navigatedTarget.name);
      return;
    }
    if (navigatedTarget.target) {
      let index = navigatedSource.dir.getEntryIndex(navigatedSource.name);
      navigatedTarget.dir.deleteEntry(navigatedTarget.name);
      navigatedTarget.dir.addEntry(index, navigatedTarget.name);
      navigatedSource.dir.deleteEntry(index);
      return;
    } else {
      let index = navigatedSource.dir.getEntryIndex(navigatedSource.name);
      navigatedTarget.dir.addEntry(navigatedTarget.name, index);
      navigatedSource.dir.deleteEntry(navigatedSource.name);
      return;
    }
  }

  rmdir (pathS, callback) {
    callback = this._maybeCallback(callback);
    this._callAsync(
      this.rmdirSync.bind(this),
      [pathS],
      callback,
      callback
    );
    return;
  }

  rmdirSync (pathS) {
    let navigated = this._navigate(pathS, false);
    if (!navigated.target) {
      throw new VirtualFSError(errno.code.ENOENT, pathS);
    }
    if (!(navigated.target instanceof Directory)) {
      throw new VirtualFSError(errno.code.ENOTDIR, pathS);
    }
    // this is for if the path resolved to root
    if (!navigated.name) {
      throw new VirtualFSError(errno.code.EBUSY, pathS);
    }
    // if this directory has subdirectory or files, then we cannot delete
    if (Object.keys(navigated.target.getEntries()).length - 2) {
      throw new VirtualFSError(errno.code.ENOTEMPTY, pathS);
    }
    navigated.dir.deleteEntry(navigated.name);
    return;
  }

  stat (pathS, callback) {
    const callback = this._maybeCallback(callback);
    this._callAsync(
      this.statSync.bind(this),
      [pathS],
      (stat) => callback(null, stat),
      callback
    );
    return;
  }

  statSync (pathS) {
    const target = this._navigate(pathS, true).target;
    if (target) {
      return new Stat(clone(target.getMetadata()));
    } else {
      throw new VirtualFSError(errno.code.ENOENT, pathS);
    }
  }

  symlink (target, pathS, ...args) {
    let cbIndex = args.findIndex((arg) => typeof arg === 'function');
    const callback = this._maybeCallback(args[cbIndex]);
    cbIndex = (cbIndex >= 0) ? cbIndex : args.length;
    this._callAsync(
      this.symlinkSync.bind(this),
      [target, pathS, ...args.slice(0, cbIndex)],
      callback,
      callback
    );
    return;
  }

  symlinkSync (target, pathS, type='file') {
    if (!target)  {
      throw new VirtualFSError(errno.code.ENOENT, [target, pathS]);
    }
    let navigated = this._navigate(pathS, false);
    if (!navigated.target && !navigated.name) {
      throw new VirtualFSError(errno.code.ENOENT, [target, pathS]);
    } else if (!navigated.target) {
      let index = this._inodeMgr.createINode(Symlink, { link: target });
      navigated.dir.addEntry(navigated.name, index);
      return;
    } else {
      throw new VirtualFSError(errno.code.EEXIST, [target, pathS]);
    }
  }

  truncate (file, ...args) {
    let cbIndex = args.findIndex((arg) => typeof arg === 'function');
    const callback = this._maybeCallback(args[cbIndex]);
    cbIndex = (cbIndex >= 0) ? cbIndex : args.length;
    this._callAsync(
      this.truncateSync.bind(this),
      [file, ...args.slice(0, cbIndex)],
      callback,
      callback
    );
    return;
  }

  truncateSync (file, len=0) {
    if (typeof file === 'string') {
      const fdIndex = this.openSync(file, 'r+');
      this.ftruncateSync(fdIndex, len);
      this.closeSync(fdIndex);
    } else if (typeof file === 'number') {
      this.ftruncateSync(file, len);
    } else {
      throw TypeError('file must be a string or number');
    }
    return;
  }

  unlink (pathS, callback) {
    const callback = this._maybeCallback(callback);
    this._callAsync(
      this.unlinkSync.bind(this),
      [pathS],
      callback,
      callback
    );
    return;
  }

  unlinkSync (pathS) {
    let navigated = this._navigate(pathS, false);
    if (!navigated.target) {
      throw new VirtualFSError(errno.code.ENOENT, pathS);
    }
    if (navigated.target instanceof Directory) {
      throw new VirtualFSError(errno.code.EISDIR, pathS);
    }
    navigated.dir.deleteEntry(navigated.name);
    return;
  }

  utimes (pathS, atime, mtime, callback) {
    const callback = this._maybeCallback(callback);
    this._callAsync(
      this.utimesSync.bind(this),
      [pathS, atime, mtime],
      callback,
      callback
    );
    return;
  }

  utimesSync (pathS, atime, mtime) {
    const target = this._navigate(pathS, true).target;
    if (!target) {
      throw new VirtualFSError(errno.code.ENOENT, pathS);
    }
    const metadata = target.getMetadata();
    const newAtime;
    if (typeof atime === 'string') {
      atime = parseInt(atime);
    }
    if (typeof mtime === 'string') {
      mtime = parseInt(mtime);
    }
    if (typeof atime === 'number') {
      newAtime = new Date(atime * 1000);
    } else if (atime instanceof Date) {
      newAtime = atime;
    } else {
      throw TypeError('atime and mtime must be dates or unixtime in seconds');
    }
    const newMtime;
    if (typeof mtime === 'number') {
      newMtime = new Date(mtime * 1000);
    } else if (mtime instanceof Date) {
      newMtime = mtime;
    } else {
      throw TypeError('atime and mtime must be dates or unixtime in seconds');
    }
    metadata.atime = newAtime;
    metadata.mtime = newMtime;
    return;
  }

  write (fdIndex, data, ...args) {
    let cbIndex = args.findIndex((arg) => typeof arg === 'function');
    const callback = this._maybeCallback(args[cbIndex]);
    cbIndex = (cbIndex >= 0) ? cbIndex : args.length;
    this._callAsync(
      this.writeSync.bind(this),
      [fdIndex, data, ...args.slice(0, cbIndex)],
      (bytesWritten) => callback(null, bytesWritten, data),
      callback
    );
    return;
  }

  writeSync (fdIndex, data, offsetOrPos, lengthOrEncoding, position=null) {
    const fd = this._fdMgr.getFd(fdIndex);
    if (!fd) {
      throw new VirtualFSError(errno.code.EBADF, 'write');
    }
    if (position < 0) {
      throw new VirtualFSError(errno.code.EINVAL, 'write');
    }
    const flags = fd.getFlags();
    if (!(flags & (constants.O_WRONLY | constants.O_RDWR))) {
      throw new VirtualFSError(errno.code.EBADF, 'write');
    }
    let buffer;
    if (data instanceof Buffer) {
      if (offsetOrPos < 0 || offsetOrPos > data.length) {
        throw new RangeError('Offset is out of bounds');
      }
      if (lengthOrEncoding < 0 || lengthOrEncoding > data.length) {
        throw new RangeError('Length is out of bounds');
      }
      buffer = data.slice(offsetOrPos, lengthOrEncoding);
    } else {
      position = offsetOrPos;
      buffer = Buffer.from(data.toString(), lengthOrEncoding);
    }
    try {
      return fd.write(buffer, position);
    } catch (e) {
      if (e instanceof RangeError) {
        throw new VirtualFSError(errno.code.ENOSPC, 'write');
      }
      throw e;
    }
  }

  writeFile (file, data, ...args) {
    let cbIndex = args.findIndex((arg) => typeof arg === 'function');
    const callback = this._maybeCallback(args[cbIndex]);
    cbIndex = (cbIndex >= 0) ? cbIndex : args.length;
    this._callAsync(
      this.writeFileSync.bind(this),
      [file, data, ...args.slice(0, cbIndex)],
      callback,
      callback
    );
    return;
  }

  writeFileSync (file, data='undefined', options={encoding:'utf8',flag:'w'}) {
    if (typeof options === 'string') {
      options = { encoding: options };
    }
    if (!options.encoding) {
      options.encoding = 'utf8';
    }
    if (!options.flag) {
      options.flag = 'w';
    }
    let fdIndex;
    let fd;
    if (typeof file === 'string') {
      fdIndex = this.openSync(file, options.flag);
      fd = this._fdMgr.getFd(fdIndex);
    } else if (typeof file === 'number') {
      fd = this._fdMgr.getFd(file);
    } else {
      throw TypeError('file must be a string or number');
    }
    if (!fd) {
      throw new VirtualFSError(errno.code.EBADF, 'writeFile');
    }
    let buffer;
    if (typeof data === 'string') {
      buffer = Buffer.from(data, options.encoding);
    } else {
      buffer = data;
    }
    return this.writeSync(fd, buffer, 0, buffer.length, 0);
  }

}

export { VirtualFS, VirtualFSError };
