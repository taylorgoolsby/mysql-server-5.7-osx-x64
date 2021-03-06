#!/usr/bin/env bash

cd ${0%/*}
rm -rf ./data/mysql/*
rm -rf ./binlog/*
./mysqld --initialize-insecure --explicit_defaults_for_timestamp --basedir=./ --datadir=./data/mysql
./mysqld --defaults-file=my.cnf --tmpdir=$(mktemp -d -t mysql) --explicit_defaults_for_timestamp
