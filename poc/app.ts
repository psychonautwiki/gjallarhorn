import * as kafka from 'kafka-node';

import * as bluebird from 'bluebird';
import * as _request from 'request';
import * as redis from 'redis';
import * as _ from 'lodash';

const request = bluebird.promisify(_request.defaults({
    // proxy: 'http://localhost:6152',
    // strictSSL: false
}));

// bluebird.promisifyAll(redis.RedisClient.prototype);

const getJSON = async url => {
    try {
        const xx = await request(url);
        return JSON.parse((xx).body);
    } catch(err) {
        console.error(err);

        return null;
    }
}

const redisClient = bluebird.promisifyAll(redis.createClient({
    host: process.env.REDIS_HOST,
    password: process.env.REDIS_PASS
})) as any;

const wait = ms => new Promise(res =>
    setTimeout(res, ms)
);

const __KAFKA_TOPIC__ = process.env.KAFKA_TOPIC;

let lastCommit = 0;
let totalCommitted = 0;

const start = process.hrtime();

setInterval(() => {
    const sinceLastCommit = totalCommitted - lastCommit;

    lastCommit = totalCommitted;
    
    console.log('[%s] [%s] [∆ %s] committed', process.hrtime(start).join('; '), totalCommitted, sinceLastCommit);
}, 1000);

(async () => {
    const client = new kafka.KafkaClient({
        kafkaHost: process.env.KAFKA_HOST + ':9092'
    });

    client.on('ready', async () => {
        const producer = new kafka.Producer(client);

        while(true) {
            // const data = _.get(await getJSON('https://www.reddit.com/r/all.json?limit=120&' + Math.random()), 'data.children');
            const data = _.get(await getJSON('https://www.reddit.com/r/all/comments/.json?limit=100&' + Math.random()), 'data.children');

            Promise.all(
                data.map(async item => {
                    await redisClient.setAsync( item.data.name, 1, 'EX', 86400 );

                    if ( await redisClient.getAsync( item.data.name ) !== null ) {
                        return;
                    }

                    producer.send([{
                        topic: __KAFKA_TOPIC__,
                        messages: [
                            JSON.stringify(item)
                        ]
                    }], async error => {
                        if ( error ) {
                            await redisClient.delAsync( item.data.name );
                        }

                        ++totalCommitted;
                    });
                })
            );
            
            await wait(1000);
        }
    });
})();