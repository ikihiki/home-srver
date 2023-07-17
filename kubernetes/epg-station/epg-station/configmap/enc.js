const spawn = require('child_process').spawn;
const execFile = require('child_process').execFile;
const ffmpeg = process.env.FFMPEG;
const ffprobe = process.env.FFPROBE;

const input = process.env.INPUT;
const output = process.env.OUTPUT;
const isDualMono = parseInt(process.env.AUDIOCOMPONENTTYPE, 10) == 2;
const uploadFlag = process.argv[2];
const genre1 = process.env.GENRE1;
const args = ['-y'];
const genres = [
    'ニュース／報道',
    'スポーツ',
    '情報／ワイドショー',
    'ドラマ',
    '音楽',
    'バラエティ',
    '映画',
    'アニメ／特撮',
    'ドキュメンタリー／教養',
    '劇場／公演',
    '趣味／教育',
    '福祉',
    '拡張',
    'その他',
];


/**
 * 動画長取得関数
 * @param {string} filePath ファイルパス
 * @return number 動画長を返す (秒)
 */
const getDuration = filePath => {
    return new Promise((resolve, reject) => {
        execFile(ffprobe, ['-v', '0', '-show_format', '-of', 'json', filePath], (err, stdout) => {
            if (err) {
                reject(err);

                return;
            }

            try {
                const result = JSON.parse(stdout);
                resolve(parseFloat(result.format.duration));
            } catch (err) {
                reject(err);
            }
        });
    });
};

/**
 * Google Drive Upload
 * @param {string} filePath ファイルパス
 */
const upload = (filePath, parent) => {
    return new Promise((resolve, reject) => {
        execFile('gdrive', ['files', 'upload', '--parent', parent, filePath], (err, stdout) => {
            if (err) {
                reject(err);
                return;
            }

            try {
                console.log(stdout)
                resolve();
            } catch (err) {
                reject(err);
            }
        });
    });
};

/**
 * Google Drive Seach Folder
 * @param {string} name フォルダ名
 */
const getFolderId = name => {
    return new Promise((resolve, reject) => {
        execFile('gdrive', ['files', 'list', '--query', `name contains '${name}'`], (err, stdout) => {
            if (err) {
                reject(err);
                return;
            }

            try {
                const dir = stdout.split('\n')[1].split(' ')[0];
                resolve(dir);
            } catch (err) {
                reject(err);
            }
        });
    });
};

/**
 * Google Drive Seach Folder
 * @param {string} name フォルダ名
 */
const makeFolderId = name => {
    return new Promise((resolve, reject) => {
        execFile('gdrive', ['files', 'mkdir', '--print-only-id', '--parent', '153zyngIfXv9QlhZ4TjjFb1w08TkxHfYY', name], (err, stdout) => {
            if (err) {
                reject(err);
                return;
            }

            try {
                resolve(stdout);
            } catch (err) {
                reject(err);
            }
        });
    });
};

/**
 * Google Drive Seach Folder
 * @param {string} name フォルダ名
 */
const uploadRecord = (filePath, genreId) => {
    return new Promise(async (resolve, reject) => {
        const genre = genres[genreId];
        let parent = '';
        try {
            parent = await getFolderId(genre);
            await upload(filePath, parent);
        } catch {
            parent = await makeFolderId(genre);
            await upload(filePath, parent);
        }

    });
};


// 字幕用
Array.prototype.push.apply(args, ['-fix_sub_duration']);
// input 設定
Array.prototype.push.apply(args, ['-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda', '-c:v', 'mpeg2_cuvid']);
Array.prototype.push.apply(args, ['-i', input]);
// ビデオストリーム設定
Array.prototype.push.apply(args, ['-map', '0:v', '-c:v', 'hevc_nvenc']);
// インターレス解除
//Array.prototype.push.apply(args, ['-vf', 'yadif']);
// オーディオストリーム設定
if (isDualMono) {
    Array.prototype.push.apply(args, [
        '-filter_complex',
        'channelsplit[FL[][FR[]',
        '-map', '[FL[]',
        '-map', '[FR[]',
        '-metadata:s:a:0', 'language=jpn',
        '-metadata:s:a:1', 'language=eng',
    ]);
} else {
    Array.prototype.push.apply(args, ['-map', '0:a']);
}
Array.prototype.push.apply(args, ['-c:a', 'aac']);
// 字幕ストリーム設定
Array.prototype.push.apply(args, ['-map', '0:s?', '-c:s', 'mov_text']);
// 品質設定
Array.prototype.push.apply(args, ['-preset', 'p7', '-b:v', '5M', '-max_muxing_queue_size', '9999']);
// 出力ファイル
Array.prototype.push.apply(args, [output]);

const encode = (input, args) => {
    return new Promise(async (resolve, reject) => {
        // 進捗計算のために動画の長さを取得
        const duration = await getDuration(input);

        const child = spawn(ffmpeg, args);

        /**
         * エンコード進捗表示用に標準出力に進捗情報を吐き出す
         * 出力する JSON
         * {"type":"progress","percent": 0.8, "log": "view log" }
         */
        child.stderr.on('data', data => {
            let strbyline = String(data).split('\n');
            for (let i = 0; i < strbyline.length; i++) {
                let str = strbyline[i];
                if (str.startsWith('frame')) {
                    // 想定log
                    // frame= 5159 fps= 11 q=29.0 size=  122624kB time=00:02:51.84 bitrate=5845.8kbits/s dup=19 drop=0 speed=0.372x
                    const progress = {};
                    const ffmpeg_reg = /frame=\s*(?<frame>\d+)\sfps=\s*(?<fps>\d+(?:\.\d+)?)\sq=\s*(?<q>[+-]?\d+(?:\.\d+)?)\sL?size=\s*(?<size>\d+(?:\.\d+)?)kB\stime=\s*(?<time>\d+[:\.\d+]*)\sbitrate=\s*(?<bitrate>\d+(?:\.\d+)?)kbits\/s(?:\sdup=\s*(?<dup>\d+))?(?:\sdrop=\s*(?<drop>\d+))?\sspeed=\s*(?<speed>\d+(?:\.\d+)?)x/;
                    let ffmatch = str.match(ffmpeg_reg);
                    /**
                     * match結果
                     * [
                     *   'frame= 5159 fps= 11 q=29.0 size=  122624kB time=00:02:51.84 bitrate=5845.8kbits/s dup=19 drop=0 speed=0.372x',
                     *   '5159',
                     *   '11',
                     *   '29.0',
                     *   '122624',
                     *   '00:02:51.84',
                     *   '5845.8',
                     *   '19',
                     *   '0',
                     *   '0.372',
                     *   index: 0,
                     *   input: 'frame= 5159 fps= 11 q=29.0 size=  122624kB time=00:02:51.84 bitrate=5845.8kbits/s dup=19 drop=0 speed=0.372x    \r',
                     *   groups: [Object: null prototype[] {
                     *     frame: '5159',
                     *     fps: '11',
                     *     q: '29.0',
                     *     size: '122624',
                     *     time: '00:02:51.84',
                     *     bitrate: '5845.8',
                     *     dup: '19',
                     *     drop: '0',
                     *     speed: '0.372'
                     *   }
                     * ]
                     */

                    if (ffmatch === null) continue;

                    progress['frame'] = parseInt(ffmatch.groups.frame);
                    progress['fps'] = parseFloat(ffmatch.groups.fps);
                    progress['q'] = parseFloat(ffmatch.groups.q);
                    progress['size'] = parseInt(ffmatch.groups.size);
                    progress['time'] = ffmatch.groups.time;
                    progress['bitrate'] = parseFloat(ffmatch.groups.bitrate);
                    progress['dup'] = ffmatch.groups.dup == null ? 0 : parseInt(ffmatch.groups.dup);
                    progress['drop'] = ffmatch.groups.drop == null ? 0 : parseInt(ffmatch.groups.drop);
                    progress['speed'] = parseFloat(ffmatch.groups.speed);

                    let current = 0;
                    const times = progress.time.split(':');
                    for (let i = 0; i < times.length; i++) {
                        if (i == 0) {
                            current += parseFloat(times[i]) * 3600;
                        } else if (i == 1) {
                            current += parseFloat(times[i]) * 60;
                        } else if (i == 2) {
                            current += parseFloat(times[i]);
                        }
                    }

                    // 進捗率 1.0 で 100%
                    const percent = current / duration;
                    const log =
                        'frame= ' +
                        progress.frame +
                        ' fps=' +
                        progress.fps +
                        ' size=' +
                        progress.size +
                        ' time=' +
                        progress.time +
                        ' bitrate=' +
                        progress.bitrate +
                        ' drop=' +
                        progress.drop +
                        ' speed=' +
                        progress.speed;

                    console.log(JSON.stringify({ type: 'progress', percent: percent, log: log }));
                }
            }
        });

        child.on('error', err => {
            console.error(err);
            reject(err);
        });

        process.on('SIGINT', () => {
            child.kill('SIGINT');
            resolve();
        });
        child.on('exit', () => {
            resolve()
        })
    })
};

(async () => {
    await encode(input, args);
    if (uploadFlag === 'upload') {
        await uploadRecord(output, genre1);
    }
})();