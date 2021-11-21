const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const app = express();
const utils = require('../../utils');
const { ERROR_CODE } = require('../../errors');

const db = new sqlite3.Database('db/main.db', (err) => {
    if (err) {
        console.error(err.message);
    };
});

const createSession = () => {
    let session = '';
    const character = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const stringLength = 32;

    for (let i = 0; i < stringLength; i++) {
        session += character.charAt(Math.floor(Math.random() * character.length));
    };

    return session;
};

const updateSession = ({ id, password }) => {
    return new Promise((resolve, reject) => {
        const session = createSession();
        db.get(`update account
                set session = "${session}"
                where id = "${id}"
                and password = "${password}"`,
            [], (err) => {
                if (err) {
                    reject(ERROR_CODE[500]);
                }
                resolve(session);
            });
    });
};

const checkLogin = ({ id, password }) => {
    return new Promise((resolve, reject) => {
        db.get(`select * from account
                where id = "${id}"
                and password = "${password}"`,
            [], (err, row) => {
                if (err) {
                    reject(ERROR_CODE[500]);
                }
                if (!Object.keys(row).length) {
                    reject({ code: 400, message: '아이디나 비밀번호가 틀렸습니다.' });
                }
                resolve(row);
            });
    });
};

app.post('/login', (req, res) => {
    const body = req.body;

    if (!utils.checkRequiredProperties(['id', 'password'], body)) {
        return res.status(400).json(ERROR_CODE[400]);
    }

    checkLogin(body)
        .then(userInfo => {
            if (!userInfo.session) {
                return updateSession(userInfo);
            }

            return userInfo.session;
        })
        .then(session => {
            utils.setSessionCookie(res, session);
            res.status(200).json({ isLogin: true });
        })
        .catch(err => {
            res.status(err.code).json(err.message);
        });
});

module.exports = app;