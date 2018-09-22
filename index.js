const fs = require('fs');
const path = require('path');
const exec = require('child_process').exec;
const spawn = require('child_process').spawn;
const mysql = require('mysql')
const cosmiconfig = require('cosmiconfig')

const explorer = cosmiconfig("mysql-server")
const rcResults = (explorer.searchSync() || {}).config || {}
const defaultConfigrc = {
  allowBlockedPort: false,
  port: 3306,
  reinitialize: false,
  verbose: false,
  mycnf: {}
}
const configrc = {
  ...defaultConfigrc,
  ...rcResults
}

const connection = mysql.createConnection({
  host     : 'localhost',
  user     : 'root',
  password : '',
  port: configrc.port
});

const defaultConfig = {
  default_time_zone: '+00:00',
  port                    : 3306,
  // Binary log settings
  server_id               : 1,
  binlog_format           : 'row',
  log_bin                 : '../../binlog/mysql-bin.log', // relative to datadir
  binlog_checksum         : 'CRC32',
  expire_logs_days        : 10,
  max_binlog_size         : '100M',
  // Settings related to this package's directory structure
  // tmpdir set in server/start.sh
  basedir                 : './',
  datadir                 : path.resolve(__dirname, 'server/data/mysql'),
  // Other settings
  innodb_buffer_pool_size : '128M',
  expire_logs_days        : '10',
  sql_mode                : 'NO_ENGINE_SUBSTITUTION,STRICT_TRANS_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER',
}

/*
Returns the child thread running mysqld.
I'm calling the return value "mysqld":
Use mysqld.stop() to stop server.
mysqld.ready is a Promise.
mysqld.ready resolves when the server is fully loaded.
mysqld.ready rejects when the port is blocked unless allowBlockedPort=true.
*/
module.exports = function() {
  const {
    allowBlockedPort,
    mycnf,
    port,
    reinitialize,
    verbose,
  } = configrc

  const fullConfig = {
    ...defaultConfig,
    ...mycnf,
    port: port,
  }

  // Generate my.cnf from provided configuration
  const myCnfFile = '[mysqld]\n' +
    Object.keys(fullConfig).map(function(key) {
      if(fullConfig[key] === null || fullConfig[key] === undefined) {
        return ''
      } else {
        return key + ' = ' + fullConfig[key]
      }
    }).join('\n');

  fs.writeFileSync(path.join(__dirname, 'server/my.cnf'), myCnfFile);

  // crude method of ensuring there is no mysqld process already running
  // exec('killall -KILL mysqld')

  const initialized = fs.existsSync(path.resolve(__dirname, 'server/data/mysql/mysql'))

  // Did not work spawning mysqld directly from node, therefore shell script
  const mysqld = spawn(path.join(__dirname,
    !initialized || reinitialize ? 'server/reinitialize.sh' : 'server/start.sh'));

  if (verbose) {
    mysqld.stdout.pipe(process.stdout)
    mysqld.stderr.pipe(process.stdout)
  }

  let doNotStop = false

  mysqld.stop = function() {
    if (doNotStop) return
    connection.on('error', err => {
      // eat error
    })
    connection.query('SHUTDOWN;')
  };

  mysqld.ready = new Promise((resolve, reject) => {
    let promiseDone = false
    mysqld.stderr.on('data', function(data) {
      const ready =
        !!data.toString().match(/MySQL Community Server/);
      const blockedPort = !!data.toString().match(/Do you already have another mysqld server running on port:/)
      const badPreviousShutdown = !!data.toString().match(/Check that you do not already have another mysqld process using the same InnoDB data or log files./)

      if (badPreviousShutdown) {
        promiseDone = false
        console.log('Previously mysql-server did not shutdown correctly. The current mysql-server is reusing this instance.')
        return resolve()
      }

      if (!promiseDone && ready) {
        promiseDone = true
        console.log(`mysql-server running on port ${port}.`)
        return resolve()
      }
      if (!promiseDone && blockedPort) {
        promiseDone = true
        if (allowBlockedPort) {
          doNotStop = true
          console.log(`mysql-server is not running. Port ${port} is in use by a different program. But allowBlockedPort=true.`)
          return resolve()
        } else {
          return reject(new Error(`Port ${fullConfig.port} is blocked. New MySQL server not started.`))
        }
      }
    })
  })

  return mysqld
}
