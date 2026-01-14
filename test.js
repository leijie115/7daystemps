let data = require('./provinces')
const fs = require('fs');

for (let i = 0; i < data.length; i++) {
  let item = data[i]
  data[i].name = item.zh_name;
  delete data[i].zh_name;
}

fs.writeFileSync('./provinces.js', 'module.exports = ' + JSON.stringify(data, null, 2))