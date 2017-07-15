/** @module FileDescriptors */

import 'babel-polyfill';
import Counter from 'resource-counter';

const fdFlags = {
  read: 1,
  write: 2,
  append: 4
};

const fdFlagCombinations = [
  fdFlags.read,
  fdFlags.write,
  fdFlags.append,
  fdFlags.read | fdFlags.write,
  fdFlags.read | fdFlags.append
];

/**
 * Class representing a File Descriptor
 */
class FileDescriptor {

  /**
   * Creates FileDescriptor
   * Starts the seek position at 0
   * @param {File} fileLike
   * @param {number} flags
   */
  constructor (fileLike, flags) {
    this._flags = flags;
    this._file = fileLike;
    this._pos = 0;
  }

  // operations required
  // seeking to a position
  // note that pipes cannot actually seek
  // so whether something is seekable or not depends on the target
  // right now targets can only be a file
  // in the future, it could be other things too...
  // on files that cannot be seeking, that means the ydont actually have a file position
  // so we can use 0 as the sentinel value in this case
  // 0 is returned if the file is fully read
  // even if one asks more a certain length, it doesn't mean they will get that length
  // they may get less than, or they may get 0
  // reading from a position to some length
  // writing from a position to some length
  // what happens if there is concurrent read to the same pipe/fifo/terminal device, on posix, this is unspecified
  // however if we read from the same file, a new file descriptor will be created for that file, and can modify that file inode concurrently
  // operations on the file descriptor can change the size of the file as well
  // if read 0, then it should just return 0
  // what happens if you try to read when the FD is only write?
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
   * @param {File} fileLike
   * @param {number} flags
   * @returns {number} The file descriptor index
   * @throws {TypeError} If invalid combination of file descriptor flags
   */
  createFd (fileLike, flags) {
    const index = this._counter.allocate();
    if (!fdFlagCombinations.includes(flags)) {
      throw new TypeError('Invalid combination of file descriptor flags');
    }
    this._fds.set(index, new FileDescriptor(fileLike, flags));
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

export { FileDescriptor, FileDescriptorManager, fdFlags };
