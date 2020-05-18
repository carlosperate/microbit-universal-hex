import * as utils from './utils';

/** Values for the Record Type field, including fat-binaries custom types. */
enum RecordType {
  Data = 0x00,
  EndOfFile = 0x01,
  ExtendedSegmentAddress = 0x02,
  StartSegmentAddress = 0x03,
  ExtendedLinearAddress = 0x04,
  StartLinearAddress = 0x05,
  BlockStart = 0x0a,
  BlockEnd = 0x0b,
  PaddedData = 0x0c,
  CustomData = 0x0d,
  OtherData = 0x0e,
}

/**
 * Defines the fields for an Intel Hex record.
 *
 * @interface Record
 */
interface Record {
  byteCount: number;
  address: number;
  recordType: RecordType;
  data: Uint8Array;
  checksum: number;
}

/**
 * The maximum data bytes per record is 0xFF, 16 and 32 bytes are the two most
 * common lengths, but to start we'll only support 16 bytes
 */
const RECORD_DATA_MAX_BYTES = 16;

/**
 * Constants for the record character lengths.
 */
const START_CODE_STR = ':';
const START_CODE_STR_LEN = START_CODE_STR.length;
const BYTE_COUNT_STR_LEN = 2;
const ADDRESS_STR_LEN = 4;
const RECORD_TYPE_STR_LEN = 2;
const DATA_STR_LEN_MIN = 0;
const CHECKSUM_STR_LEN = 2;
const MIN_RECORD_STR_LEN =
  START_CODE_STR_LEN +
  BYTE_COUNT_STR_LEN +
  ADDRESS_STR_LEN +
  RECORD_TYPE_STR_LEN +
  DATA_STR_LEN_MIN +
  CHECKSUM_STR_LEN;
const MAX_RECORD_STR_LEN =
  START_CODE_STR_LEN +
  BYTE_COUNT_STR_LEN +
  ADDRESS_STR_LEN +
  RECORD_TYPE_STR_LEN +
  RECORD_DATA_MAX_BYTES * 2 +
  CHECKSUM_STR_LEN;

/**
 * Checks if a given number is a valid Record type.
 *
 * @param recordType Number to check
 * @returns True if it's a valid Record type.
 */
function isRecordTypeValid(recordType: RecordType): boolean {
  // Checking ranges is more efficient than object key comparison
  // This also allow us use a const enum (compilation replaces it by literals)
  if (
    (recordType >= RecordType.Data &&
      recordType <= RecordType.StartLinearAddress) ||
    (recordType >= RecordType.BlockStart && recordType <= RecordType.OtherData)
  ) {
    return true;
  }
  return false;
}

/**
 * Calculates the Intel Hex checksum.
 *
 * This is basically the LSB of the two's complement of the sum of all bytes.
 *
 * @param dataBytes A byte array to calculate the checksum into.
 * @returns Checksum byte.
 */
function calcChecksumByte(dataBytes: Uint8Array): number {
  const sum = dataBytes.reduce(
    (accumulator, currentValue) => accumulator + currentValue,
    0
  );
  return -sum & 0xff;
}

/**
 * Creates an Intel Hex record with normal or custom record types.
 *
 * @param address - The two least significant bytes for the data address.
 * @param recordType - Record type, could be one of the standard types or any
 *    of the custom types created for forming fat binaries.
 * @param dataBytes - Byte array with the data to include in the record.
 * @returns A string with the Intel Hex record.
 */
function createRecord(
  address: number,
  recordType: RecordType,
  dataBytes: Uint8Array
): string {
  if (address < 0 || address > 0xffff) {
    throw new Error(`Record (${recordType}) address out of range: ${address}`);
  }
  const byteCount = dataBytes.length;
  if (byteCount > RECORD_DATA_MAX_BYTES) {
    throw new Error(
      `Record (${recordType}) data has too many bytes (${byteCount}).`
    );
  }
  if (!isRecordTypeValid(recordType)) {
    throw new Error(`Record type '${recordType}' is not valid.`);
  }

  const recordContent = utils.concatUint8Arrays([
    new Uint8Array([byteCount]),
    new Uint8Array([address >> 8, address & 0xff]),
    new Uint8Array([recordType]),
    dataBytes,
  ]);
  const recordContentStr = utils.byteArrayToHexStr(recordContent);
  const checksumStr = utils.byteToHexStrFast(calcChecksumByte(recordContent));
  return `${START_CODE_STR}${recordContentStr}${checksumStr}`;
}

/**
 * Check if the an Intel Hex record conforms to the following rules:
 *  - Correct length of characters
 *  - Starts with a colon
 *
 * TODO: Apply more rules.
 *
 * @param iHexRecord - Single Intel Hex record to check.
 * @returns A boolean indicating if the record is valid.
 */
function validateRecord(iHexRecord: string): boolean {
  if (iHexRecord.length < MIN_RECORD_STR_LEN) {
    throw new Error(`Record length too small: ${iHexRecord}`);
  }
  if (iHexRecord.length > MAX_RECORD_STR_LEN) {
    throw new Error(`Record length is too large: ${iHexRecord}`);
  }
  if (iHexRecord[0] !== ':') {
    throw new Error(`Record does not start with a ":": ${iHexRecord}`);
  }
  return true;
}

/**
 * Retrieves the Record Type form an Intel Hex record line.
 *
 * @param iHexRecord Intel hex record line without line terminator.
 * @returns The RecordType value.
 */
function getRecordType(iHexRecord: string): RecordType {
  validateRecord(iHexRecord);
  const recordTypeCharStart =
    START_CODE_STR_LEN + BYTE_COUNT_STR_LEN + ADDRESS_STR_LEN;
  const recordTypeStr = iHexRecord.slice(
    recordTypeCharStart,
    recordTypeCharStart + RECORD_TYPE_STR_LEN
  );
  const recordType = parseInt(recordTypeStr, 16);
  if (!isRecordTypeValid(recordType)) {
    throw new Error(`Record type '${recordTypeStr}' is not valid.`);
  }
  return recordType;
}

/**
 * Parses an Intel Hex record into an Record object with its respective fields.
 *
 * @param iHexRecord Intel hex record line without line terminator.
 * @returns New object with the Record interface.
 */
function parseRecord(iHexRecord: string): Record {
  validateRecord(iHexRecord);
  let recordBytes;
  try {
    recordBytes = utils.hexStrToBytes(iHexRecord.substring(1));
  } catch (e) {
    throw new Error(
      `Could not parse Intel Hex record "${iHexRecord}": ${e.message}`
    );
  }
  const byteCountIndex = 0;
  const byteCount = recordBytes[0];

  const addressIndex = byteCountIndex + BYTE_COUNT_STR_LEN / 2;
  const address =
    (recordBytes[addressIndex] << 8) + recordBytes[addressIndex + 1];

  const recordTypeIndex = addressIndex + ADDRESS_STR_LEN / 2;
  const recordType = recordBytes[recordTypeIndex];

  const dataIndex = recordTypeIndex + RECORD_TYPE_STR_LEN / 2;
  const data = recordBytes.subarray(dataIndex, -1);

  const checksumIndex = dataIndex + byteCount;
  const checksum = recordBytes[checksumIndex];

  const totalLength = checksumIndex + CHECKSUM_STR_LEN / 2;
  if (recordBytes.length > totalLength) {
    throw new Error(
      `Parsed record "${iHexRecord}" is larger than indicated by the byte count.` +
        `\n\tExpected: ${totalLength}; Length: ${recordBytes.length}.`
    );
  }

  return {
    byteCount,
    address,
    recordType,
    data,
    checksum,
  };
}

/**
 * Creates an End Of File Intel Hex record.
 *
 * @returns End of File record with new line.
 */
function endOfFileRecord(): string {
  // No need to use createRecord(), this record is always the same
  return ':00000001FF';
}

/**
 * Creates an Extended Linear Address record from a 4 byte address.
 *
 * @param address - Full 32 bit address.
 * @returns The Extended Linear Address Intel Hex record.
 */
function extLinAddressRecord(address: number): string {
  if (address < 0 || address > 0xffffffff) {
    throw new Error(
      `Address '${address}' for Extended Linear Address record is in range.`
    );
  }
  return createRecord(
    0,
    RecordType.ExtendedLinearAddress,
    new Uint8Array([(address >> 24) & 0xff, (address >> 16) & 0xff])
  );
}

/**
 * Creates a Block Start (custom) Intel Hex Record.
 *
 * @param boardId Board ID to embed into the record, 0 to 0xFFF.
 * @returns A Block Start (custom) Intel Hex record.
 */
function blockStartRecord(boardId: number): string {
  if (boardId < 0 || boardId > 0xffff) {
    throw new Error('Board ID out of range when creating Block Start record.');
  }
  return createRecord(
    0,
    RecordType.BlockStart,
    new Uint8Array([(boardId >> 8) & 0xff, boardId & 0xff, 0xc0, 0xde])
  );
}

/**
 * Create Block End (custom) Intel Hex Record.
 *
 * The Data field in this Record will be ignored and can be used for padding.
 *
 * @param padBytesLen Number of bytes to add to the Data field.
 * @returns A Block End (custom) Intel Hex record.
 */
function blockEndRecord(padBytesLen: number): string {
  // Input sanitation will be done in createRecord, no need to do it here too
  const recordData = new Uint8Array(padBytesLen).fill(0xff);
  return createRecord(0, RecordType.BlockEnd, recordData);
}

/**
 * The Block end record can add bytes to the data field to be generate 512 byte
 * blocks. This function exposes how many bytes the record can fit.
 *
 * @returns Number of padding bytes that fit inside a Block End (custom) Record.
 */
function recordPaddingCapacity(): number {
  return RECORD_DATA_MAX_BYTES;
}

/**
 * Create a Padded Data (custom) Intel Hex Record.
 * This record is used to add padding data, to be ignored by DAPLink, to be able
 * to create blocks of 512-bytes.
 *
 * @param padBytesLen Number of bytes to add to the Data field.
 * @returns A Padded Data (custom) Intel Hex record.
 */
function paddedDataRecord(padBytesLen: number): string {
  // Input sanitation will be done in createRecord, no need to do it here too
  const recordData = new Uint8Array(padBytesLen).fill(0xff);
  return createRecord(0, RecordType.PaddedData, recordData);
}

/**
 * Changes the record type of a Record to a Custom Data type.
 *
 * The data field is kept, but changing the record type will trigger the
 * checksum to be updated as well.
 *
 * @param iHexRecord Intel hex record line without line terminator.
 * @returns A Custom Data Intel Hex record with the same data field.
 */
function convertRecordToCustomData(iHexRecord: string): string {
  const record = parseRecord(iHexRecord);
  return createRecord(record.address, RecordType.CustomData, record.data);
}

/**
 * Separates an Intel Hex file (string) into an array of Record strings.
 *
 * @param iHexStr Intel Hex file as a string.
 * @returns Array of Records in string format.
 */
function iHexToRecordStrs(iHexStr: string): string[] {
  // For some reason this is quicker than .split(/\r?\n/)
  // Up to x200 faster in Chrome (!) and x1.5 faster in Firefox
  const output = iHexStr.replace(/\r/g, '').split('\n');

  // Boolean filter removes all falsy values as some of these files contain
  // multiple empty lines we want to remove
  return output.filter(Boolean);
}

export {
  RecordType,
  createRecord,
  getRecordType,
  parseRecord,
  endOfFileRecord,
  extLinAddressRecord,
  blockStartRecord,
  blockEndRecord,
  paddedDataRecord,
  recordPaddingCapacity,
  convertRecordToCustomData,
  iHexToRecordStrs,
};
