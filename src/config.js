
let entorno = require('./configEntorno')

let user = 'usr_erp2025'
let password = 'TBMIpFT9U#DD_1'
let database = 'ERP_CIE'
if(entorno == 'desarrollo'){
    server = '201.174.34.106'
    port = 1520
}
if(entorno == 'pruebas'){
    server = '201.174.34.106'
    port = 1521
}
if(entorno == 'produccion'){
    user = 'vit_services'
    password = 'oi98feku12nx'
    server = 'vit.spaceti.cloud'
    port = 1525
}


const sqlConfigString = {
  user : user,
  password : password,
  server : server, // or server adress
  database : database,
  port:port,
  options : {
    encrypt : true, //for azure
    trustServerCertificate : true // change to false if you have a valid certificate
  },
}

module.exports = sqlConfigString


