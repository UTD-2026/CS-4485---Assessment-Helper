// MongoDB's own _id values (notifications, ...): a 24-character hex string, or the driver's ObjectId object.
const HEX24 = /^[0-9a-fA-F]{24}$/;

/** A 24-hex string, or an actual ObjectId (the database driver's id objects carry _bsontype 'ObjectId'). */
const isObjectId = (value) => (typeof value === 'string' && HEX24.test(value))
  || (Boolean(value) && typeof value === 'object' && /^ObjectI[dD]$/.test(value._bsontype || '') && HEX24.test(String(value)));

module.exports = { isObjectId };
