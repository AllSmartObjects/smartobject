'use strict';

var _ = require('busyman'),
    lwm2mId = require('lwm2m-id');

function SmartObject() {}

/*************************************************************************************************/
/*** Public Methods                                                                            ***/
/*************************************************************************************************/
SmartObject.prototype.has = function (oid, iid, rid) {
    var oidkey = getOidKey(oid), 
        ridkey,
        has = false;

    if (!_.isUndefined(iid) && !isValidArgType(iid)) 
        throw new TypeError('iid should be a String or a Number.');

    has = _.isObject(this[oidkey]);

    if (has && !_.isNil(iid)) {
        has = has && _.isObject(this[oidkey][iid]);
        if (has && !_.isNil(rid)) {
            ridkey = getRidKey(oid, rid);
            has = !_.isUndefined(this[oidkey][iid][ridkey]);
        }
    }

    return has;
};

// this is like readSync
SmartObject.prototype.get = function (oid, iid, rid) {
    var oidkey = getOidKey(oid), 
        ridkey,
        target;

    if (!isValidArgType(iid) && !_.isNil(iid)) 
        throw new TypeError('iid should be a String or a Number.');

    if (this.has(oid, iid, rid)) {
        target = this[oidkey];

        if (!_.isNil(iid)) {
            target = this[oidkey][iid];

            if (!_.isNil(rid)) {
                ridkey = getRidKey(oid, rid);
                target = this[oidkey][iid][ridkey];
            }
        }
    }

    return target;
};

// like write sync
SmartObject.prototype.setResource = function (oid, iid, rid, value) {
    var oidkey = getOidKey(oid), 
        ridkey = getRidKey(oid, rid),
        set = false;

    if (!isValidArgType(iid))
        throw new TypeError('iid should be a String or a Number.');
    
    if (!this.has(oid, iid, rid))
        return set;

    this[oidkey][iid][ridkey] = value;
    set = true;

    return set;
};

SmartObject.prototype.objectList = function () {
    var objList = [];

    _.forEach(this, function (obj, oid) {
        if (_.isObject(obj)) {
            _.forEach(obj, function (inst, iid) {
                var iidNum = parseInt(iid);
                iidNum = _.isNaN(iidNum) ? iid : iidNum;

                if (_.isObject(inst))
                    objList.push({ oid: getOidNum(oid), iid: iidNum });
            });
        }
    });

    return objList;
};

SmartObject.prototype.create = function (oid) {
    if (!isValidArgType(oid)) 
        throw new TypeError('oid should be a String or a Number.');

    this[oid] = this[oid] || {};
    return oid;
};

// Use createIpsoOnly() if the user like me to check for him
SmartObject.prototype.createIpsoOnly = function (oid) {
    var oidKey = getOidKey(oid);
    return isIpsoOid(oidKey) ? this.create(oidKey) : null;
};

SmartObject.prototype.addResources = function (oid, iid, resrcs) {
    var self = this,
        oidKey = getOidKey(oid),
        ridKey = null,
        newIObj = false;

    if (!this.has(oidKey))
        return null;

    if (_.isPlainObject(iid) && _.isNil(resrcs)) {
        resrcs = iid;
        iid = null;
    }

    if (_.isNil(iid))
        iid = getFreeIid(this, oidKey);

    if (!isValidArgType(iid))
        throw new TypeError('iid should be a String or a Number.');

    if (!_.isPlainObject(resrcs))
        throw new TypeError('resource should be an object.');

    this[oidKey][iid] = this[oidKey][iid] || {};

    _.forEach(resrcs, function (val, rid) {
        if (_.isFunction(val) || _.isNil(val))  {
            // [FIXME] why we don't accept null?
            throw new TypeError('resource cannot be a function, null, or undefined.');
        }

        ridKey = getRidKey(oidKey, rid);

        if (_.isObject(val))
            val._isCb = _.isFunction(val.read) || _.isFunction(val.write) || _.isFunction(val.exec);

        self[oidKey][iid][ridKey] = val;
    });

    return {
        oid: oidKey,
        iid: iid.toString(),
        rid: ridKey
    };
};

SmartObject.prototype.dump = function (oid, iid, callback) {
    var dumped = {},
        dumpType = 'so';

    if (arguments.length === 0) {
        callback = undefined;
        dumpType = 'so';
    } else if (arguments.length === 1) {
        callback = oid;
        dumpType = 'so';
    } else if (arguments.length === 2) {
        callback = iid;
        dumpType = 'obj';
    } else if (arguments.length === 3) {
        dumpType = 'objInst';
    } else {
        throw new Error('Bad arguments.');
    }

    if (!_.isFunction(callback))
        throw new Error('Callback should be a function.');

    if (dumpType === 'so')
        dumpSmartObject(this, callback);
    else if (dumpType === 'obj')
        dumpObject(this, oid, callback);
    else if (dumpType === 'objInst')
        dumpObjectInstance(this, oid, iid, callback);
    else
        invokeCbNextTick(new Error('Unkown type to dump.'), null, callback);

};

SmartObject.prototype.readResource = function (oid, iid, rid, callback) {
    if (_.isNil(iid))
        throw new TypeError('iid should be a String or a Number.');

    if (_.isNil(rid))
        throw new TypeError('rid should be a String or a Number.');

    var rsc = this.get(oid, iid, rid);

    if (_.isUndefined(rsc)) {
        invokeCbNextTick(new Error('Resource not found.'), null, callback);
        return;
    } 

    if (_.isObject(rsc)) {
        if (rsc._isCb) {
            // an exec resource cannot be read, so checks for it first
            if (_.isFunction(rsc.exec)) {
                invokeCbNextTick(null, '_exec_', callback);
            } else if (_.isFunction(rsc.read)) {
                rsc.read(function (err, val) {
                    invokeCbNextTick(err, val, callback);
                });
            } else {
                invokeCbNextTick(null, '_unreadable_', callback);
            }
        } else {
            invokeCbNextTick(null, _.omit(rsc, [ '_isCb' ]), callback);
        }
    } else if (_.isFunction(rsc)) {
        invokeCbNextTick(new Error('Resource not found.'), null, callback);
    } else {
        invokeCbNextTick(null, rsc, callback);
    }
};

SmartObject.prototype.writeResource = function (oid, iid, rid, value, callback) {
    if (_.isNil(iid))
        throw new TypeError('iid should be a String or a Number.');

    if (_.isNil(rid))
        throw new TypeError('rid should be a String or a Number.');

    var rsc = this.get(oid, iid, rid);

    if (_.isUndefined(rsc)) {
        invokeCbNextTick(new Error('Resource not found.'), null, callback);
        return;
    }

    if (_.isObject(rsc) && rsc._isCb) {
        if (_.isFunction(rsc.exec)) {
            invokeCbNextTick(null, '_exec_', callback);
        } else if (_.isFunction(rsc.write)) {
            rsc.write(value, function (err, val) {
                invokeCbNextTick(err, val, callback);
            });
        } else {
            invokeCbNextTick(null, '_unwritable_', callback);
        }
    } else if (_.isFunction(rsc)) {
        invokeCbNextTick(new Error('Resource cannot be a function.'), null, callback);
    } else { 
        if (this.setResource(oid, iid, rid, value))
            invokeCbNextTick(null, value, callback);
        else
            invokeCbNextTick(new Error('Resource not found.'), null, callback);
    }
};

SmartObject.prototype.execResource = function (oid, iid, rid, argus, callback) {
    if (_.isNil(iid))
        throw new TypeError('iid should be a String or a Number.');

    if (_.isNil(rid))
        throw new TypeError('rid should be a String or a Number.');

    var rsc = this.get(oid, iid, rid);

    if (_.isFunction(argus)) {
        callback = argus;
        argus = [];
    }

    if (_.isUndefined(argus))
        argus = [];

    if (_.isUndefined(rsc)) {
        invokeCbNextTick(new Error('Resource not found.'), null, callback);
    } else if (!_.isArray(argus)) {
        invokeCbNextTick(new TypeError('argus should be an array.'), null, callback);
    } else {
        if (_.isObject(rsc) && _.isFunction(rsc.exec)) {
            argus.push(function (execErr, val) {
                invokeCbNextTick(execErr, val, callback);
            });
            rsc.exec.apply(this, argus);
        } else {
            invokeCbNextTick(null, '_unexecutable_', callback);
        }
    }
};

/*************************************************************************************************/
/*** Server-only prototype methods                                                             ***/
/*************************************************************************************************/
// [TODO]
function dumpSync() {
    var dump = {};

    _.forEach(this, function (obj, oidKey) {
        if (_.isObject(obj)) {
            dump[oidKey] = {};

            _.forEach(obj, function (iObj, iid) {
                dump[oidKey][iid] = {};
                _.forEach(iObj, function (rsc, ridKey) {
                    dump[oidKey][iid][ridKey] = rsc._isCb ? '_callback_' : _.cloneDeep(rsc);
                });
            });
        }

    });

    return dump;
}

/*************************************************************************************************/
/*** Private Functions                                                                         ***/
/*************************************************************************************************/
function isValidArgType(param) {
    var isValid = true;

    if (!_.isNumber(param) && !_.isString(param))
        isValid = false;
    else if (_.isNumber(param))
        isValid = !isNaN(param);

    return isValid;
}

function isIpsoOid(oid) {
    var oidItem = lwm2mId.getOid(oid);
    return oidItem ? true : false;
}

function getOidKey(oid) {
    // lwm2m-id itself will throw TypeError if oid is not a string and not a number
    var oidItem = lwm2mId.getOid(oid);
    return oidItem ? oidItem.key : oid;
}

function getOidNum(oid) {
    // lwm2m-id itself will throw TypeError if oid is not a string and not a number
    var oidItem = lwm2mId.getOid(oid);
    return oidItem ? oidItem.value : oid;
}

function getRidKey(oid, rid) {
    var ridItem;

    if (_.isUndefined(rid)) {
        rid = oid;
        oid = undefined;
    }

    // lwm2m-id itself will throw TypeError if rid is not a string and not a number
    ridItem = lwm2mId.getRid(oid, rid);
    return ridItem ? ridItem.key : rid;
}

function getFreeIid(so, oidKey) {
    var iid = null;

    if (so[oidKey]) {
        iid = 0;

        while (!_.isNil(so[oidKey][iid])) {
          iid += 1;
        }
    }

    return iid;
}

function dumpObjectInstance(so, oid, iid, callback) {
    var objInst = so.get(oid, iid),
        dumped = objInst ? {} : null,
        resrcNum = objInst ? _.keys(objInst).length : 0;

    if (!objInst) {
        callback(new Error('Target not found, cannot dump.'), null)
    } else {
        _.forEach(objInst, function (val, ridKey) {
            so.readResource(oid, iid, ridKey, function (err, data) {
                if (err) {
                    callback(err, null);
                } else {
                    dumped[ridKey] = data;
                    resrcNum -= 1;

                    if (resrcNum === 0 && _.isFunction(callback))
                        callback(null, dumped);
                }
            });
        });
    }
}

function dumpObject(so, oid, callback) {
    var obj = so.get(oid),
        dumped = obj ? {} : null,
        instNum = obj ? _.keys(obj).length : 0;

    if (!obj) {
        callback(new Error('Target not found, cannot dump.'), null);
    } else {
        _.forEach(obj, function (objInst, iidKey) {
            dumpObjectInstance(so, oid, iidKey, function (err, data) {
                if (err) {
                    callback(err, null);
                } else {
                    dumped[iidKey] = data;
                    instNum -= 1;

                    if (instNum === 0 && _.isFunction(callback))
                        callback(null, dumped);
                }
            });
        });
    }
}

function dumpSmartObject(so, callback) {
    var dumped = {},
        objNum = _.keys(so).length;

    _.forEach(so, function (obj, oidKey) {
        dumpObject(so, oidKey, function (err, data) {
            if (err) {
                callback(err, null);
            } else {
                dumped[oidKey] = data;
                objNum -= 1;

                if (objNum === 0 && _.isFunction(callback))
                    callback(null, dumped);
            }
        });
    });
}

function invokeCbNextTick(err, val, cb) {
    if (_.isFunction(cb))
        process.nextTick(function () {
            cb(err, val);
        });
}

module.exports = SmartObject;
