/** @module FileDescriptors */

import 'babel-polyfill';
import Counter from 'resource-counter';
import { File } from './INodes';

/**
 * Class representing a File Descriptor
 */
class FileDescriptor {

  /**
   * Creates FileDescriptor
   * Starts the seek position at 0
   * @param {File} inode
   * @param {number} flags
   */
  constructor (inode, flags) {
    this._flags = flags;
    this._inode = inode;
    this._pos = 0;
  }

  // fcntl operations

  getFlags () {
    return this._flags;
  }

  setFlags (flags) {
    this._flags = flags;
    return;
  }

  getINode () {
    return this._inode;
  }

  // seek operations

  getPos () {
    return this._pos;
  }

  setPos (pos) {
    this._pos = pos;
    return;
  }

  // only if the position is null, do we use and move the position
  // otherwise it's equivalent to a pwrite, were position is temporary
  // another important aspect is whether the inode can be read
  // a readable inode generally has a data property for us
  // so basically we'll switch between appropriate reads or whatever
  // the caller should already slice the appropriate buffer part and give it to use to read/write
  // hence we always read and write to the full length of the buffer...
  // so use offset=0 and length=0 to slice the appropriate buffer

  // these checks are managed outside
  // this is done via the buffer
  // if position is > actual data
  // fdpos is not changed
  // 0 data is read
  //
  // if position < actual data (this only happens if position < 0), so it can be checked directly
  // Error: EINVAL: invalid argument, read

  // if offset < buffer
  // Error: Offset is out of bounds
  // if offset > buffer
  // Error: Offset is out of bounds

  // if length > actual buffer
  // RangeError: Length extends beyond buffer
  // if length < actual buffer
  // RangeError: Length extends beyond buffer
  // if length > than actual data, but within buffer, you only read up to that amount and no more
  // we assume checks are already applied and the buffer is the buffer you want read into, and the position is exactly a number > 0 OR null

  // if currentPosition is greater than data, this copies 0 bytes
  read (buffer, position=null) {
    let currentPosition;
    if (position === null) {
      currentPosition = this.getPos();
    } else {
      currentPosition = position;
    }
    const iNode = this.getINode();
    let bytesRead;
    switch (true) {
    case iNode instanceof File:
      const data = iNode.getData();
      const metadata = iNode.getMetadata();
      bytesRead = data.copy(buffer, 0, currentPosition);
      metadata.atime = new Date;
      break;
    default:
      throw new TypeError('Invalid INode type for read');
    }
    if (position !== null) {
      this.setPos(currentPosition + bytesRead);
    }
    return bytesRead;
  }

  // problem is appending
  // if the O_APPEND is specified, then writes should append
  // but even if it isn't appendFileSync would directly append as well
  // hence there should be a way to acquire the position parameter, to always append
  // perhaps a third special case for position?
  // because perhaps there's a need to figure the length?
  // perhaps through the metadat?
  // nooo they are all bad, it must be done through the file descriptor
  // in Linux, for O_APPEND, the position is ignored
  // but how does appendFileSync work for fds that don't have O_APPEND?
  // the way appendFileSync works, is that it temporarily adds the O_APPEND flag before performing a write
  // ok say appendFileSync ends up temporarily adding O_APPEND (by copying the options object and assigning this extra attribute)
  // it's not just adding on the flag, it FORCES the 'a' style, which sets its own flags there
  // then it needs to apply, still the problem is that something must now check O_APPEND
  // what does this? if the JS caller doesn't do this, then we need to do this

  // what happens if position is > the data available
  // does it write nothing as well?
  // it actually just becomes EQUIVALENT to O_APPEND

  write (buffer, position=null) {
    let currentPosition;
    if (position === null) {
      currentPosition = this.getPos();
    } else {
      currentPosition = position;
    }
    const iNode = this.getINode();
    let bytesWritten;
    switch (true) {
    case iNode instanceof File:
      let data = iNode.getData();
      const metadata = iNode.getMetadata();
      if (this.getFlags() & constants.O_APPEND) {
        data = Buffer.concat(data, buffer);
        bytesWritten = buffer.length;
        iNode.setData(data);
      } else {
        currentPosition = Math.min(data.length, currentPosition);
        const overwrittenLength = data.length - currentPosition;
        const extendedLength = buffer.length - overwrittenLength;
        if (extendedLength > 0) {
          data = Buffer.concat(data, Buffer.allocUnsafe(extendedLength));
        }
        bytesWritten = buffer.copy(data, currentPosition);
        iNode.setData(data);
      }
      const now = new Date;
      metadata.mtime = now;
      metadata.ctime = now;
      metadata.size = data.length;
      break;
    default:
      throw new TypeError('Invalid INode type for write');
    }
    if (position !== null) {
      this.setPos(currentPosition + bytesWritten);
    }
    return bytesWritten;
  }

  // file descriptors also need to expose truncate operation
  // the fd position should be changed, although this needs testing as well
  truncate (len=0) {

  }


}

/**
 * Class that manages all FileDescriptors
 */
class FileDescriptorManager {

  /**
   * Creates an instance of the FileDescriptorManager
   * It starts the fd counter at 0
   * Make sure not get real fd numbers confused with these fd numbers
   */
  constructor () {
    this._counter = new Counter(0);
    this._fds = new Map;
  }

  /**
   * Creates a file descriptor
   * While a file descriptor is opened, the underlying iNode will not be garbage collected
   * @param {File|Directory} inode
   * @param {number} flags
   * @returns {{index: number, fd: FileDescriptor}}
   */
  createFd (inode, flags) {
    const index = this._counter.allocate();
    const fd = new FileDescriptor(inode, flags);
    this._fds.set(index, fd);
    return { index: index, fd: fd };
  }

  /**
   * Gets the file descriptor object
   * @param {number} index
   * @returns {FileDescriptor}
   */
  getFd (index) {
    return this._fds.get(index);
  }

  /**
   * Deletes a file descriptor
   * This effectively closes the file descriptor
   * @param {number} index
   */
  deleteFd (index) {
    this._counter.deallocate(index);
    this._fds.delete(index);
    return;
  }

}

export { FileDescriptor, FileDescriptorManager };
