/** @module FileDescriptors */

import 'babel-polyfill';
import Counter from 'resource-counter';

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

  getPos () {
    return this._pos;
  }

  setPos (pos) {
    this._pos = pos;
    return;
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
   * @returns {number} The file descriptor index
   * @throws {TypeError} If invalid combination of file descriptor flags
   */
  createFd (inode, flags) {
    const index = this._counter.allocate();
    this._fds.set(index, new FileDescriptor(inode, flags));
    return index;
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
