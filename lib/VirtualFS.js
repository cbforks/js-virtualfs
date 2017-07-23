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
  _navigate (pathS, resolveLastLink=true) {
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
    return this._navigateFrom(this._root, pathS, resolveLastLink);
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
  _navigateFrom (curdir, pathS, resolveLastLink) {
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
      return this._navigateFrom(target, parse.rest, resolveLastLink);
    case target instanceof Symlink:
      if (!resolveLastLink && !parse.rest) {
        return {
          dir: curdir,
          target: target,
          name: parse.segment,
          remaining: parse.rest
        };
      }
      let symlink = path.posix.join(target.getLink(), parse.rest);
      if (symlink[0] === '/') {
        return this._navigate(symlink, resolveLastLink);
      } else {
        return this._navigateFrom(curdir, symlink, resolveLastLink);
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

  appendFileSync (file, data, optionsOrEncoding) {

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

  fsyncSync (fdIndex) {
    if (!this._fdMgr.getFd(fdIndex)) {
      throw new VirtualFSError(errno.code.EBADF, 'fsync');
    }
    return;
  }

  fdatasyncSync (fdIndex) {
    if (!this._fdMgr.getFd(fdIndex)) {
      throw new VirtualFSError(errno.code.EBADF, 'fdatasync');
    }
    return;
  }

  chmodSync (pathS, mode) {
    if (!this._navigate(pathS, true).target) {
      throw new VirtualFSError(errno.code.ENOENT, pathS);
    }
    return;
  }

  lchmodSync (pathS, mode) {
    if (!this._navigate(pathS, false).target) {
      throw new VirtualFSError(errno.code.ENOENT, pathS);
    }
    return;
  }

  fchmodSync (fdIndex, mode) {
    if (!this._fdMgr.getFd(fdIndex)) {
      throw new VirtualFSError(errno.code.EBADF, 'fchmod');
    }
    return;
  }

  chownSync (pathS, uid, gid) {
    if (!this._navigate(pathS, true).target) {
      throw new VirtualFSError(errno.code.ENOENT, pathS);
    }
    return;
  }

  lchownSync (pathS, uid, gid) {
    if (!this._navigate(pathS, false).target) {
      throw new VirtualFSError(errno.code.ENOENT, pathS);
    }
    return;
  }

  fchownSync (fdIndex, uid, gid) {
    if (!this._fdMgr.getFd(fdIndex)) {
      throw new VirtualFSError(errno.code.EBADF, 'fchown');
    }
    return;
  }

  chown (pathS, uid, gid, callback) {
    if (!this._navigate(pathS, true).target) {
      throw new VirtualFSError(errno.code.ENOENT, pathS);
    }
    callback();
  }


  existsSync (pathS) {
    try {
      return !!(this._navigate(pathS, true).target);
    } catch (e) {
      return false;
    }
  }

  statSync (pathS) {
    const target = this._navigate(pathS, true).target;
    if (target) {
      return new Stat(clone(target.getMetadata()));
    } else {
      throw new VirtualFSError(errno.code.ENOENT, pathS);
    }
  }

  lstatSync (pathS) {
    const target = this._navigate(pathS, false).target;
    if (target) {
      return new Stat(clone(target.getMetadata()));
    } else {
      throw new VirtualFSError(errno.code.ENOENT, pathS);
    }
  }

  fstatSync (fdIndex) {
    const fd = this._fdMgr.getFd(fdIndex);
    if (!fd) {
      throw new VirtualFSError(errno.code.EBADF, 'fstat');
    }
    return new Stat(clone(fd.getINode().getMetadata()));
  }

  writeFileSync (pathS, data='undefined', optionsOrEncoding) {
    // coercing undefined to 'undefined' is nodejs behaviour
    const navigated = this._navigate(pathS, true);
    if (!navigated.target && !navigated.name) {
      throw new VirtualFSError(errno.code.ENOENT, pathS);
    }
    if (!navigated.target && navigated.remaining) {
      throw new VirtualFSError(errno.code.ENOENT, pathS);
    }
    if (navigated.target instanceof Directory) {
      throw new VirtualFSError(errno.code.EISDIR, pathS);
    }
    const encoding =
          typeof optionsOrEncoding === "object"
          ? optionsOrEncoding.encoding
          : optionsOrEncoding;
    if (optionsOrEncoding || typeof data === 'string') {
      data = Buffer(data, encoding);
    }
    if (navigated.target instanceof File) {
      navigated.target.write(data);
    } else {
      let index = this._inodeMgr.createINode(File, { data: data });
      navigated.dir.addEntry(navigated.name, index);
    }
    return;
  }

  mkdirSync (pathS) {
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

  mkdirpSync (pathS) {
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

  symlinkSync (target, pathS) {
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

  readFileSync (pathS, optionsOrEncoding) {
    let target = this._navigate(pathS, true).target;
    if (!target) {
      throw new VirtualFSError(errno.code.ENOENT, pathS);
    }
    if (target instanceof Directory) {
      throw new VirtualFSError(errno.code.EISDIR, pathS);
    }
    const encoding =
          typeof optionsOrEncoding === "object"
          ? optionsOrEncoding.encoding
          : optionsOrEncoding;
    return encoding ? target.read().toString(encoding) : cloneBuffer(target.read());
  }

  readdirSync (pathS) {
    let navigated = this._navigate(pathS, true);
    if (!navigated.target) {
      throw new VirtualFSError(errno.code.ENOENT, pathS);
    }
    if (navigated.target instanceof Symlink) {
      throw new VirtualFSError(errno.code.ENOTDIR, pathS);
    }
    return Object.keys(navigated.target.getEntries()).filter((v) => {
      return v !== '.' && v !== '..';
    });
  }

  readlinkSync (pathS) {
    let target = this._navigate(pathS, false).target;
    if (!target) {
      throw new VirtualFSError(errno.code.ENOENT, pathS);
    }
    if (!(target instanceof Symlink)) {
      throw new VirtualFSError(errno.code.EINVAL, pathS);
    }
    return target.getLink();
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
        const index = this._inodeMgr.createINode(File, { data: new Buffer });
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
      // must be directory if O_DIRECTORY
      if ((flags & constants.O_DIRECTORY) && !(target instanceof Directory)) {
        throw new VirtualFSError(errno.code.ENOTDIR, pathS);
      }
    }
    // must truncate a file if O_TRUNC
    if ((flags & constants.O_TRUNC) &&
        (target instanceof File) &&
        (flags & (constants.O_WRONLY | constants.O_RDWR)))
    {
      target.write(new Buffer(0));
    }
    return this._fdMgr.createFd(target, flags);
  }

  readSync (fdIndex, buffer, offset=0, length=0, position=null) {
    const fd = this._fdMgr.getFd(fdIndex);
    if (!fd) {
      throw new VirtualFSError(errno.code.EBADF, 'read');
    }
    const flags = fd.getFlags();
    const iNode = fd.getINode();
    let currentPosition;
    if (position === null) {
      currentPosition = fd.getPos();
    } else {
      currentPosition = position;
    }
    if (flags !== constants.O_RDONLY && !(flags & constants.O_RDWR)) {
      throw new VirtualFSError(errno.code.EBADF, 'read');
    }
    if (iNode.getMetadata().isDirectory()) {
      throw new VirtualFSError(errno.code.EISDIR, 'read');
    }
    const iNodeBuffer = iNode.read();
    const bytesRead = iNodeBuffer.copy(buffer, currentPosition, offset, offset + length);
    fd.setPos(currentPosition + bytesRead);
    return bytesRead;
  }

  writeSync (fdIndex, bufOrStr, offsetOrPos, lengthOrEncoding, position) {
    const fd = this._fdMgr.getFd(fdIndex);
    if (!fd) {
      throw new VirtualFSError(errno.code.EBADF, 'write');
    }
    const flags = fd.getFlags();
    const iNode = fd.getINode();
    const iNodeBuffer = iNode.read();
    if (!(flags & (constants.O_WRONLY | constants.O_RDWR))) {
      throw new VirtualFSError(errno.code.EBADF, 'wrte');
    }
    let currentPosition;
    if (bufOrStr instanceof Buffer || bufOrStr instanceof Uint8Array) {
      if (flags & constants.O_APPEND) {
        currentPosition = iNodeBuffer.length;
      } else if (typeof position !== 'number') {
        currentPosition = fd.getPos();
      } else {
        currentPosition = position;
      }
    } else {
      bufOrStr = bufOrStr.toString();
      if (flags & constants.O_APPEND) {
        currentPosition = iNodeBuffer.length;
      } else if (typeof offsetOrPos !== 'number') {
        currentPosition = fd.getPos();
      } else {
        currentPosition = offsetOrPos;
      }
      bufOrStr = Buffer(bufOrStr, lengthOrEncoding);
    }
    const copyLength = iNodeBuffer.length - currentPosition;
    const copyBuffer = bufOrStr.slice(0, copyLength);
    const extendBuffer = bufOrStr.slice(copyLength);
    copyBuffer.copy(iNodeBuffer, currentPosition);
    const writtenBuffer = Buffer.concat(iNodeBuffer, extendBuffer);
    iNode.write(writtenBuffer);
    fd.setPos(currentPosition + writtenBuffer.length);
    return writtenBuffer.length;
  }

  closeSync (fdIndex) {
    if (!this._fdMgr.getFd(fdIndex)) {
      throw new VirtualFSError(errno.code.EBADF, 'close');
    }
    this._fdMgr.deleteFd(fd);
    return;
  }

  createReadStream(pathS, options) {
    let stream = new ReadableStream();
    let done = false;
    let data;
    try {
      data = this.readFileSync(pathS);
    } catch (e) {
      stream._read = function() {
        if (done) {
          return;
        }
        done = true;
        this.emit('error', e);
        this.push(null);
      };
      return stream;
    }
    options = options || { };
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

  createWriteStream (pathS) {
    let stream = new WritableStream();
    try {
      // Zero the file and make sure it is writable
      this.writeFileSync(pathS, new Buffer(0));
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
    return callback(this.existsSync(pathS));
  }

  writeFile (pathS, content, encoding, callback) {
    if(!callback) {
      callback = encoding;
      encoding = undefined;
    }
    try {
      this.writeFileSync(pathS, content, encoding);
    } catch(e) {
      return callback(e);
    }
    return callback();
  }


}

['stat', 'lstat', 'readdir', 'mkdirp', 'rmdir', 'unlink', 'readlink'].forEach((fn) => {
  VirtualFS.prototype[fn] = function (pathS, callback) {
    let result;
    try {
      result = this[fn + "Sync"](pathS);
    } catch(e) {
      setImmediate(() => {
        callback(e);
      });
      return;
    }
    setImmediate(() => {
      callback(null, result);
    });
  };
});

['access', 'chmod', 'mkdir', 'readFile', 'symlink', 'link', 'rename'].forEach((fn) => {
  VirtualFS.prototype[fn] = function (pathS, optArg, callback) {
    if(!callback) {
      callback = optArg;
      optArg = undefined;
    }
    let result;
    try {
      result = this[fn + "Sync"](pathS, optArg);
    } catch(e) {
      setImmediate(() => {
        callback(e);
      });
      return;
    }
    setImmediate(() => {
      callback(null, result);
    });
  };
});

export { VirtualFS, VirtualFSError };
