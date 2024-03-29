const express = require('express');
const app = express();
const utils = require('../../utils');
const { ERROR_CODE } = require('../../errors');
const { MAJOR_MAP } = require('../../common');
const dayjs = require('dayjs');
const CLASS_REGISTRATION_START = '2021-09-01 08:00:00'; //테스트용
const CLASS_REGISTRATION_END = '2021-09-05 23:59:59'; //테스트용
const CURRENT_DATE = '2021-09-04 08:00:01'; //테스트용
const year = dayjs(CLASS_REGISTRATION_START).format('YYYY'); //테스트용
const term = dayjs(CURRENT_DATE).format('M') < '7' ? '1' : '2'; //테스트용

const knex = require('knex')({
    client: 'sqlite3',
    connection: {
        filename: 'db/main.db'
    },
    useNullAsDefault: true
});

const getId = session => {
    return knex('account')
        .select('id')
        .where({ session })
        .first();
};

const formatClassTime = (start, end) => {
    const result = [];

    for (let i = start; i <= end; i++) {
        result.push(i);
    };

    return result;
};

const formatClassList = classList => {
    return classList.reduce((classList, { startTime, endTime, day, max, count, major, ...list }) => {
        if (count >= max) {
            list.isDisable = true;
        }

        list.major = MAJOR_MAP[major];
        list.lectureDate = `${formatClassTime(startTime, endTime).join(',')} / ${day}`;
        list.personnel = `${count} / ${max}`;

        classList.push(list);

        return classList;
    }, []);
};

const getClassList = async (condition) => {
    return await knex('lecture')
        .select(
            'dept.name as deptName',
            'professor.name as professorName',
            'lecture.id as lectureId',
            'lecture.credit',
            'lecture.major',
            'lecture.start_time as startTime',
            'lecture.end_time as endTime',
            'lecture.day',
            'lecture.name as lectureName',
            'lecture.max_personnel as max'
        )
        .count('class_registration.lecture_id as count')
        .innerJoin('dept', 'lecture.dept_id', 'dept.code')
        .innerJoin('professor', 'lecture.prof_id', 'professor.id')
        .leftOuterJoin('class_registration', 'lecture.id', 'class_registration.lecture_id')
        .where(condition)
        .groupBy('lecture.id');
};

const isValidDate = currentDate => {
    return !dayjs(CLASS_REGISTRATION_START).isBefore(currentDate) || dayjs(CLASS_REGISTRATION_END).isBefore(currentDate);
};

app.get('/list', (req, res) => {
    const cookie = req.headers.cookie;
    const session = utils.getSession(cookie);

    if (!cookie || !session) {
        return res.status(ERROR_CODE[401].code).json(ERROR_CODE[401].message);
    }

    getId(session)
        .then(async ({ id }) => {
            if (!id) {
                return Promise.reject(ERROR_CODE[401]);
            }

            return knex('dept')
                .select(
                    'code as deptId',
                    'name as deptName'
                );
        })
        .then(deptList => {
            res.status(200).json(deptList);
        })
        .catch(failed => {
            if (isNaN(failed.code)) {
                return res.status(500).json(ERROR_CODE[500].message);
            }

            res.status(failed.code).json(failed.message);
        });
});

app.get('/registration', (req, res) => {
    const cookie = req.headers.cookie;
    const session = utils.getSession(cookie);


    if (!cookie || !session) {
        return res.status(ERROR_CODE[401].code).json(ERROR_CODE[401].message);
    }

    // const currentDate = dayjs().format('YYYY-MM-DD HH:mm:ss'); //현재 날짜

    if (isValidDate(CURRENT_DATE)) {
        return res.status(409).json('수강신청 날짜가 아닙니다.');
    }

    const { deptId, professorName, lectureName } = req.query;

    getId(session)
        .then(({ id }) => {
            if (!id) {
                return Promise.reject(ERROR_CODE[401]);
            }

            const condition = {
                ...!!deptId && { 'dept.code': deptId },
                ...!!professorName && { 'professor.name': professorName },
                ...!!lectureName && { 'lecture.name': lectureName },
                year,
                term
            };

            return getClassList(condition);

        })
        .then(classList => {
            res.status(200).json({ classList: formatClassList(classList) });
        })
        .catch(failed => {
            if (isNaN(failed.code)) {
                return res.status(500).json(ERROR_CODE[500].message);
            }

            res.status(failed.code).json(failed.message);
        });
});

const getTotalCredit = arr => {
    return arr.reduce((acc, cur) => {
        acc += cur.credit;

        return acc;
    }, 0);
}

app.get('/registration/list', (req, res) => {
    const cookie = req.headers.cookie;
    const session = utils.getSession(cookie);

    if (!cookie || !session) {
        return res.status(ERROR_CODE[401].code).json(ERROR_CODE[401].message);
    }

    getId(session)
        .then(({ id }) => {
            if (!id) {
                return Promise.reject(ERROR_CODE[401]);
            }
            const condition = {
                student_id: id
            };

            return getClassList(condition);
        })
        .then(classRegistrationList => {
            const totalCredit = getTotalCredit(classRegistrationList);

            res.status(200).json({ totalCredit, classRegistrationList: formatClassList(classRegistrationList) });
        })
        .catch(failed => {
            if (isNaN(failed.code)) {
                return res.status(500).json(ERROR_CODE[500].message);
            }

            res.status(failed.code).json(failed.message);
        });
});

const checkValidRegistration = (applicationList, classRegistrationList) => {
    const result = classRegistrationList.reduce((result, classRegistration) => {
        if (classRegistration.day === applicationList.day) {
            const applicationListClassTime = formatClassTime(applicationList.startTime, applicationList.endTime);
            const classRegistrationListClassTime = formatClassTime(classRegistration.startTime, classRegistration.endTime);

            result = applicationListClassTime.reduce((result, classTime, i) => {
                if (classRegistrationListClassTime[i] === classTime) {
                    result = { code: 400, message: '현재 신청중인 목록과 시간이 겹칩니다.' };
                }

                return result;
            }, {})
        }

        if (classRegistration.lecture_id === applicationList.id) {
            result = { code: 400, message: '현재 신청중인 목록입니다.' };
        }

        return result;
    }, {})

    return result;
};

app.post('/registration', (req, res) => {
    const cookie = req.headers.cookie;
    const session = utils.getSession(cookie);
    const lectureId = req.body.lectureId;

    if (!lectureId) {
        return res.status(ERROR_CODE[400].code).json(ERROR_CODE[400].message);
    }

    if (!cookie || !session) {
        return res.status(ERROR_CODE[401].code).json(ERROR_CODE[401].message);
    }

    // const currentDate = dayjs().format('YYYY-MM-DD HH:mm:ss'); //현재 날짜

    if (isValidDate(CURRENT_DATE)) {
        return res.status(409).json('수강신청 날짜가 아닙니다.');
    }

    const { deptId, professorName, lectureName } = req.body.queries || {};

    getId(session)
        .then(({ id }) => {
            if (!id) {
                return Promise.reject(ERROR_CODE[401]);
            }

            return Promise.all([id,
                knex('lecture')
                    .select(
                        'lecture.id',
                        'lecture.max_personnel as max',
                        'lecture.start_time as startTime',
                        'lecture.end_time as endTime',
                        'lecture.day',
                        'lecture.credit'
                    )
                    .count('class_registration.lecture_id as count')
                    .leftOuterJoin('class_registration', 'lecture.id', 'class_registration.lecture_id')
                    .where({ 'lecture.id': lectureId })
                    .groupBy('lecture.id')
                    .first(),
                knex('class_registration')
                    .select(
                        'class_registration.lecture_id',
                        'lecture.start_time as startTime',
                        'lecture.end_time as endTime',
                        'lecture.day',
                        'lecture.credit'
                    )
                    .innerJoin('lecture', 'class_registration.lecture_id', 'lecture.id')
                    .where({
                        'class_registration.student_id': id
                    })
            ]);
        })
        .then(([id, classInfo, classRegistrationInfo]) => {
            const totalCredit = getTotalCredit(classRegistrationInfo);
            const validTestResult = checkValidRegistration(classInfo, classRegistrationInfo);

            if (totalCredit + classInfo.credit > 21) {
                return Promise.reject({ code: 400, message: '신청할 수 있는 학점을 초과하였습니다.' });
            }

            if (Object.keys(validTestResult).length !== 0) {
                return Promise.reject(validTestResult);
            }

            if (classInfo.count >= classInfo.max) {
                return Promise.reject({ code: 400, message: '수강인원이 초과하였습니다.' });
            }

            return Promise.all([id, knex('class_registration')
                .insert({
                    student_id: id,
                    lecture_id: classInfo.id
                })
            ]);
        })
        .then(([id, ignore]) => {
            const condition = {
                ...!!deptId && { 'dept.code': deptId },
                ...!!professorName && { 'professor.name': professorName },
                ...!!lectureName && { 'lecture.name': lectureName },
                year,
                term
            };

            const condition2 = {
                student_id: id
            };

            return Promise.all([getClassList(condition), getClassList(condition2)]);
        })
        .then(([classList, classRegistrationList]) => {
            const totalCredit = getTotalCredit(classRegistrationList);

            res.status(200).json({ totalCredit, classList: formatClassList(classList), classRegistrationList: formatClassList(classRegistrationList) });
        })
        .catch(failed => {
            if (isNaN(failed.code)) {
                return res.status(500).json(ERROR_CODE[500].message);
            }

            res.status(failed.code).json(failed.message);
        });
});

app.delete('/registration/:lectureId', (req, res) => {
    const cookie = req.headers.cookie;
    const session = utils.getSession(cookie);
    const lectureId = req.params.lectureId;

    if (!lectureId && isNaN(lectureId)) {
        return res.status(ERROR_CODE[400].code).json(ERROR_CODE[400].message);
    }

    if (!cookie || !session) {
        return res.status(ERROR_CODE[401].code).json(ERROR_CODE[401].message);
    }

    const { deptId, professorName, lectureName } = req.body.queries || {};

    getId(session)
        .then(({ id }) => {
            if (!id) {
                return Promise.reject(ERROR_CODE[401]);
            }

            return knex('class_registration')
                .select('student_id as id')
                .where({
                    lecture_id: lectureId,
                    student_id: id
                })
                .first();
        })
        .then(({ id }) => {
            if (!id) {
                return Promise.reject({ code: 409, message: '신청되지않은 강의입니다.' });
            }

            return Promise.all([id, knex('class_registration')
                .where({
                    lecture_id: lectureId,
                    student_id: id
                })
                .delete()]);
        })
        .then(([id, ignore]) => {
            const condition = {
                ...!!deptId && { 'dept.code': deptId },
                ...!!professorName && { 'professor.name': professorName },
                ...!!lectureName && { 'lecture.name': lectureName },
                year,
                term
            };

            const condition2 = {
                student_id: id
            };

            return Promise.all([getClassList(condition), getClassList(condition2)]);
        })
        .then(([classList, classRegistrationList]) => {
            const totalCredit = getTotalCredit(classRegistrationList);

            res.status(200).json({ totalCredit, classList: formatClassList(classList), classRegistrationList: formatClassList(classRegistrationList) });
        })
        .catch(failed => {
            if (isNaN(failed.code)) {
                return res.status(500).json(ERROR_CODE[500].message);
            }

            res.status(failed.code).json(failed.message);
        });
});

module.exports = app;