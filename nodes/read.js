module.exports = function (RED) {
	var connection_pool = require("../connection_pool.js");
	
	function mcRead(config) {
		RED.nodes.createNode(this, config);
    this.name = config.name;
    this.topic = config.topic;
    this.connection = config.connection;
		this.address = config.address || "";//address
		this.addressType = config.addressType || "str";
		this.outputFormat = config.outputFormat || 0;

    this.connectionConfig = RED.nodes.getNode(this.connection);
    var context = this.context();
    var node = this;
		node.busy = false;
		//node.busyMonitor;
		node.busyTimeMax = 1000;//TODO: Parameterise hard coded value!
    //var mcprotocol = require('../mcprotocol.js');
    if (this.connectionConfig) {
			var options = Object.assign({}, node.connectionConfig.options);
      node.client = connection_pool.get(this.connectionConfig.port, this.connectionConfig.host, options);
      node.status({fill:"yellow",shape:"ring",text:"initialising"});

      this.client.on('error', function (error) {
        console.log("Error: ", error);
				node.status({fill:"red",shape:"ring",text:"error"});
				node.busy = false;
      });
      this.client.on('open', function (error) {
        node.status({fill:"green",shape:"dot",text:"connected"});
      });
      this.client.on('close', function (error) {
				node.status({fill:"red",shape:"dot",text:"not connected"});
				node.busy = false;
      });


			function myReply(problem, msg) {
				clearTimeout(node.busyMonitor);
				if(!node.busy){
          return;//not busy - dont process the reply (node may have timed out)
        }
				node.busy = false;//reset busy - allow node to be triggered
				node.msgMem.mcReadDetails = {};
				node.msgMem.mcReadDetails.request = node.request;
				node.msgMem.mcReadDetails.response = msg;
				node.msgMem.mcReadDetails.timeout = msg.timeout;//TODO
				node.msgMem.mcReadDetails.error = problem;
				node.msgMem.payload = null;

        if(msg.timeout)  {
          node.status({fill:"red",shape:"ring",text:"timeout"});
					node.error("timeout");
					var dbgmsg = {
            f: 'myReply(msg)',
            msg: msg,
            error: 'timeout'
          }
					console.error(dbgmsg);
					node.msgMem.mcReadDetails.errorMsg = 'timeout';
					node.send(node.msgMem);
          return;
				}

				if(problem)  {
          node.status({fill:"grey",shape:"ring",text:"Quality Issue"});
				} else {
					node.status({fill:"green",shape:"dot",text:"Good"});
				}

				// msg.deviceCode
				// msg.digitSpec
				// msg.dataType
				// msg.deviceNo 
				// msg.isGood 
				// msg.quality 
				// msg.TAG 
				// msg.addr 
				// msg.timeTaken 
				// msg.timeStamp 
				// msg.value 
				// msg.valueType 

				var data = msg.value;
				if(data && !problem) {
					let iWD = msg.deviceNo;
					let loopBit = 0, bitNo = msg.bitOffset;
					let JSONData = {};
					if(node.outputFormat == 0/*JSON*/){
						if(msg.valueType == "CHAR") {
							if(msg.deviceCodeNotation == 'Hexadecimal'){
								buff_address = `${msg.deviceCode}${Number(iWD).toString(16).toUpperCase()}`;
							} else {
								buff_address = `${msg.deviceCode}${iWD}`
							}
							JSONData[buff_address] =  data;
						} else {
							for (var x in data) {
								let buff_address = '';
								if(msg.dataType == 'BIT' && msg.deviceCodeType != "BIT"){
									bitNo = msg.bitOffset + loopBit;
									if(bitNo == 16) iWD++;
									if(bitNo >= 16){
										bitNo = bitNo - 16
									}
									if(msg.deviceCodeNotation == 'Hexadecimal'){
										buff_address = `${msg.deviceCode}${Number(iWD).toString(16).toUpperCase()}.${Number(bitNo).toString(16).toUpperCase()}`
									} else {
										buff_address = `${msg.deviceCode}${iWD}.${Number(bitNo).toString(16).toUpperCase()}`
									}
									JSONData[buff_address] =  data[x];
									loopBit++;
									if(loopBit >= 16)
										loopBit = 0;
								} else {
									if(msg.deviceCodeNotation == 'Hexadecimal'){
										buff_address = `${msg.deviceCode}${Number(iWD).toString(16).toUpperCase()}`
									} else {
										buff_address = `${msg.deviceCode}${iWD}`
									}
									JSONData[buff_address] =  data[x];
									iWD += (msg.dataTypeByteLength/2);
								}
								
							}
						}
						node.msgMem.payload = JSONData;
					} else {
						node.msgMem.payload = data;
					}
				}
        node.send(node.msgMem);
      }

			this.on('input', function (msg) {
				if(node.busy)
					return;//TODO: Consider queueing inputs?

				node.request = undefined;
				node.msgMem = msg;

				var addr;
				RED.util.evaluateNodeProperty(node.address,node.addressType,node,msg,(err,value) => {
					if (err) {
						node.error("Unable to evaluate address");
						node.status({fill:"red",shape:"ring",text:"Unable to evaluate address"});
						return;
					} else {
						addr = value;
					}
				}); 

				if(addr == "")	{
					node.error("address is empty");
					node.status({fill:"red",shape:"ring",text:"error"});
					return;
				}


				try {
					node.status({fill:"yellow",shape:"ring",text:"read"});
					node.busy = true;

					node.request = { 
						outputFormat: node.outputFormat ? 'Array' : 'JSON',
						address: addr,
            timeStamp: Date.now()
					};

					if (node.busyTimeMax) {
						node.busyMonitor = setTimeout(function() {
							if(node.busy){
								node.status({fill:"red",shape:"ring",text:"timeout"});
								node.error("timeout");
								node.busy = false;
								return;
							}
						}, node.busyTimeMax);
					}
					this.client.read(addr, myReply);
				} catch (error) {
          node.busy = false;
          node.error(error);
					node.status({fill:"red",shape:"ring",text:"error"});
					var dbgmsg = { 
						info: "read.js-->on 'input'",
            connection: `host: ${node.connectionConfig.host}, port: ${node.connectionConfig.port}`, 
            address: addr,
					 };
					console.debug(dbgmsg);
          return;
				}
				
			});
			node.status({fill:"green",shape:"ring",text:"ready"});

		} else {
			node.error("configuration not setup");
			node.status({fill:"red",shape:"ring",text:"error"});
    }
	}
	RED.nodes.registerType("MC Read", mcRead);
	mcRead.prototype.close = function() {
		if (this.client) {
			this.client.disconnect();
		}
	}
};

