var webusb = {};
var lightsParent;

const REPORT_TYPE_FEATURE = 0x03
const REPORT_TYPE_SIZE = 8
const HID_GET_REPORT = 1
const HMAC_CHALRESP_SLOT2 = 0x38
const SLOT_WRITE_FLAG = 0x80 // send by the host, cleared by the device
const RESP_PENDING_FLAG = 0x40    /* Response pending flag */   
const SHA1_HASH_LENGTH = 40

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function str2ab(str) {
    var buf = new Array(64); 
    for (var i=0, strLen=str.length; i<strLen; i++) {
          buf[i] = str.charCodeAt(i) & 0xFF;
        }
    for (var i = str.length; i < 64; i++) {
        buf[i] = 0;
    }
    return buf;
}

function  yk_endian_swap_16(x) {
    console.log("Big endian is not supported, so this function is a NO-OP");
    return x;
}

function _create_report_size_message() {
    return {
        recipient: "interface",
        requestType: "class",
        request: HID_GET_REPORT,
        value: REPORT_TYPE_FEATURE << 8,
        index: 0,
        length: REPORT_TYPE_SIZE,
        timeout: 1000
    }
}

function _wait_for_key_status(device, boolean_and, flag, sleeptime) {

  return new Promise(async function(resolve, reject) {
    await sleep(sleeptime);
    device.controlTransferIn(_create_report_size_message(), REPORT_TYPE_SIZE)
        .then(data => {
          var status_flag = data.data.getUint8(data.data.byteLength -1);
          if ((status_flag & flag) == boolean_and) {
            resolve(data.data);
          } else {
            _wait_for_key_status(device, boolean_and, flag)
              .then((wanted_data) => {resolve(wanted_data)});
          }
      });
  });
}

function _read_hash_from_key(device, acc) {
  return new Promise(function(resolve, reject) {
    result = acc
    _wait_for_key_status(device, RESP_PENDING_FLAG, RESP_PENDING_FLAG, 100)
      .then(data => {
        for (var i = 0; i < data.byteLength -1; i++)
          result += data.getUint8(i).toString(16);
        if (result.length > SHA1_HASH_LENGTH) {
          resolve(result);
          return 
        } 
        return _read_hash_from_key(device, result)
            .then((final_result) => resolve(final_result));
      });
  });
}

function yubikey_crc16 (buf) {
    var m_crc = 0xffff;

    buf.forEach(function (value, index) {
        var i, j;
        m_crc ^= value & 0xFF;
        for (i = 0; i < 8; i++) {
            j = m_crc & 1;
            m_crc >>= 1;
            if (j)
                m_crc ^= 0x8408;
        }
        m_crc &= 0xFFFF;
    });
    return m_crc;
}

function chunk_buffer(data) {
  // slice the data on nine different chunks
  var data_chunks = [];
  var start, end;
  for (var i = 0; i < 9; i ++) {
    start = i * 7;
    end = (i + 1) * 7;
    thischunk = data.slice(start, end);
    if (thischunk.reduce((acc, value) => {return acc += value}) == 0) {
      continue; // this was all zero's, no need to send this chunk
    }
    thischunk.push(SLOT_WRITE_FLAG | (i & 0x0F));
    data_chunks.push(thischunk);
  }

  // now we prepare the header.
  header = new Array(8);  
  crc = yubikey_crc16(data);
  header[0] = 0;

  // we could probably make this work using a toggle in the interface
  header[1] = HMAC_CHALRESP_SLOT2;
  header[2] = crc & 0xff;
  header[3] = (crc & 0xff00) >> 8;
  header[4] = 0
  header[5] = 0
  header[6] = 0
  header[7] = SLOT_WRITE_FLAG | (i & 0x0F);
  data_chunks.push(header);

  result = []
  data_chunks.forEach((value, i) => {
    arrayChunk = new Uint8Array(8);
    value.forEach((value, i) => {
      arrayChunk[i] = value;
    })
    result.push(arrayChunk);
  });

  return result;
}



(function() {
  'use strict';
  webusb.devices = {};

  function findOrCreateDevice(rawDevice) {
    let device = webusb.getDevice(rawDevice);
    if (device === undefined)
      device = new webusb.Device(rawDevice);
    return device;
  }

  webusb.getDevices = function() {
    return navigator.usb.getDevices().then(devices => {
      return devices.map(device => findOrCreateDevice(device));
    });
  };

  webusb.requestDevice = function() {
    var filters = [
      { vendorId: 0x1050, productId: 0x0111 }
    ];
    return navigator.usb.requestDevice({filters: filters}).then(device => {
      return findOrCreateDevice(device);
    });
  };

  webusb.Device = function(device) {
    this.device_ = device;
    webusb.devices[device.serialNumber] = this;
  };

  webusb.deleteDevice = function(device) {
    delete webusb.devices[device.device_.serialNumber];
  };

  webusb.getDevice = function(device) {
    return webusb.devices[device.serialNumber];
  };

  webusb.Device.prototype.connect = function() {
    return this.device_.open()
      .then(() => {
        if (this.device_.configuration === null) {
          return this.device_.selectConfiguration(1);
        }
      })
      .then(() => this.device_.claimInterface(0));
  };

  webusb.Device.prototype.disconnect = function() {
    return this.device_.close();
  };

  webusb.Device.prototype.controlTransferOut = function(setup, data) {
    return this.device_.controlTransferOut(setup, data);
  };

  webusb.Device.prototype.controlTransferIn = function(setup, length) {
    return this.device_.controlTransferIn(setup, length);
  };

  webusb.Device.prototype.challengeResponse = function (challenge) {

    var challenge_buffer = str2ab(challenge);
    var data_chunks = chunk_buffer(challenge_buffer);

    var thispromise;

    data_chunks.reduce((acc, value) => {
       return acc.then(() => {return _wait_for_key_status(this.device_, 0, SLOT_WRITE_FLAG, 200)})
         .then((ayylmao) => {this.controlTransferOut(this._prepare_transfer_info(), 
           value)});
    }, this.connect())
      .then(() => {return _read_hash_from_key(this.device_, "")})
      .then((hash) => {hash = hash.slice(0, SHA1_HASH_LENGTH);
        document.getElementById("response-field").innerHTML = "Response:<br/>" +  hash;})
      .then(() => {this.disconnect();});
  }

  webusb.Device.prototype._prepare_transfer_info = function(data) {

    return {
        recipient: "interface",
        requestType: "class",
        request: 9,
        value: 0x0300,
        index: 0,
    }
  };

})();

function logDeviceStrings(device) {
  console.log("Connection:",
	            device.device_.manufacturerName,
	            device.device_.productName,
	            device.device_.serialNumber);
}


function setElementDeviceInfo(e, text) {
  e.getElementsByClassName("lightTitle")[0].innerText = text;
}

function connectDevice(device) {

  var e = document.getElementById("lightCardTemplate");
  e.style.display = "block";
  device.element = e;
  var s = device.device_.productName + "\n" +
    device.device_.serialNumber;
  setElementDeviceInfo(device.element, s);

  var sendButton = document.getElementById("send-challenge");
  sendButton.addEventListener('click', challengeResponse.bind(this, device));
}

function handleConnectEvent(event) {
  var rawDevice = event.device;
  console.log('connect event', rawDevice);
  var device = new webusb.Device(rawDevice);
  connectDevice(device);
}

function cleanUpDevice(device) {
  clearInterval(device.intervalId);
  webusb.deleteDevice(device);
}

function disconnectDevice(rawDevice) {
  var device = webusb.getDevice(rawDevice);
  if (device) {  // This can fail if the I/O code already threw an exception
    console.log("removing!");
    lightsParent.removeChild(device.element);
    device.disconnect()
      .then(s => {
        console.log("disconnected", device);
        cleanUpDevice(device);
      }, e => {
        console.log("nothing to disconnect", device);
        cleanUpDevice(device);
      });
  }
}

function handleDisconnectEvent(event) {
  console.log('disconnect event', event.device);
  disconnectDevice(event.device);
}

function registerEventListeners() {
  navigator.usb.addEventListener('connect', handleConnectEvent);
  navigator.usb.addEventListener('disconnect', handleDisconnectEvent);

}
function startInitialConnections() {
  webusb.getDevices().then(devices => {
    for (var i in devices) {
      var device = devices[i];
      connectDevice(device);
    }
  });
}

function requestConnection(event) {
  webusb.requestDevice().then(device => {
    console.log(device);
    connectDevice(device);
  });
  event.preventDefault();
}

function challengeResponse(device) {

  var challenge = document.getElementById("challenge-field").value
  response = device.challengeResponse(challenge);
  document.getElementById("response-field").innerHTML = response;

}

function start() {
  registerEventListeners();

  var lightsConnect = document.getElementById("lightConnect");
  lightsConnect.addEventListener("click", requestConnection);

  lightsParent = document.getElementById("lightsParent");
  startInitialConnections();
}

document.addEventListener('DOMContentLoaded', start, false);

