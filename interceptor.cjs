const {protocol} = require('electron');
const path = require('path');
const fs = require('fs');

const bgList = [1,15,2,3,4,5,6,23,9,10,11,12,13,14,26,17,18,19,20,21]

module.exports = async function (mainWindow) {
    // const programDir = path.dirname(require('electron').app.getPath('exe')); // 程序目录
    // let afterjs = false;
    //
    // const filter = {
    //     urls: ['*://web.sanguosha.com/*'] // 要拦截的地址
    // };

    // function configInit() {
    //     const afterPath = path.join(programDir, '/resources/after.js');
    //     if (!fs.existsSync(afterPath)) return;
    //     afterjs = true;
    // }
    //
    // configInit();
    function checkFileExists(filePath) {
        return new Promise((resolve) => {
            const fullPath = path.resolve(filePath);
            fs.access(fullPath, fs.constants.F_OK, (err) => {
                resolve(!err);
            });
        });
    }

    async function createFileExistenceDictionary(type) {
        const fileExistDict = {};
        for (let index = 1; index <= 16; index++) {
            const basePath = path.join(__dirname, `${index}`);
            const Path = `${basePath}` + '.' + type;
            const exists = await checkFileExists(Path);
            fileExistDict[index] = exists;
        }
        return fileExistDict;
    }

    const MP4Dict = await createFileExistenceDictionary('MP4');
    const JPGDict = await createFileExistenceDictionary('JPG');
    const PNGDict = await createFileExistenceDictionary('PNG');
    // protocol.registerSchemesAsPrivileged([
    //     { scheme: 'myprotocol', privileges: { secure: true, standard: true, corsEnabled: true, bypassCSP: true } }
    // ]);
    // protocol.registerFileProtocol('myprotocol', (request, callback) => {
    //     const url = request.url.substr(12); // remove 'myprotocol://'
    //     callback({ path: path.join(__dirname, url) });
    // });
    // // 注册自定义协议以重定向到本地文件
    protocol.registerFileProtocol('myprotocol', (request, callback) => {
        const url = request.url.substr(12); // 去掉协议部分
        const localPath = path.join(__dirname, url); // 基于 URL 的本地文件路径

        // 读取文件并添加 CORS 头
        const mimeType = getMimeType(localPath);
        callback({
            mimeType: mimeType,
            path: localPath,
            headers: {
                'Access-Control-Allow-Origin': '*', // 添加 CORS 头
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                'Cache-Control': 'no-cache, no-store, must-revalidate', // 禁止缓存
                'Pragma': 'no-cache',
                'Expires': '0'
            }
        });

    });

    function getMimeType(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        switch (ext) {
            case '.html':
                return 'text/html';
            case '.js':
                return 'application/javascript';
            case '.css':
                return 'text/css';
            case '.png':
                return 'image/png';
            case '.jpg':
                return 'image/jpeg';
            case '.gif':
                return 'image/gif';
            case '.mp4':
                return 'video/mp4';
            case '.webm':
                return 'video/webm';
            case '.avi':
                return 'video/x-msvideo';
            case '.mov':
                return 'video/quicktime';
            default:
                return 'application/octet-stream';
        }
    }


    const ses = mainWindow.webContents.session;

    async function processRequest(details, callback) {
        const url = details.url;
        if (url === 'https://mygame.5054399.com/js/stat.js' || url.startsWith('https://4399logs.4399doc.com/event/')) {
            callback({cancel: true});
        } else if (url.startsWith('https://web.sanguosha.com/220/h5_2/res/assets/cards/normal/officerCards.webp')) {
            const Path = path.join(__dirname, `cards.webp`);
            try {
                if (await checkFileExists(Path)) {
                    const localImagePath = `myprotocol:/cards.webp`;
                    callback({redirectURL: localImagePath});
                } else {
                    callback({});
                }
            } catch (error) {
                console.error('Error checking file existence:', error);
                callback({});
            }
        } else if (url.startsWith('https://web.sanguosha.com/220/h5_2/res/runtime/pc/wallpaper/bg/')) {
            const regex = /\/(\d+)\.(jpg|png)(?=\?v=\-?\d+|$)/;
            const match = url.match(regex);
            if (match) {
                const index = bgList.indexOf(parseInt(match[1])) + 1;
                const basePath = path.join(__dirname, `${index}`);
                const videoPath = `${basePath}.MP4`;
                const jpgPath = `${basePath}.JPG`;
                const pngPath = `${basePath}.PNG`;

                try {
                    const [videoExists, jpgExists, pngExists] = await Promise.all([
                        checkFileExists(videoPath),
                        checkFileExists(jpgPath),
                        checkFileExists(pngPath)
                    ]);

                    if (MP4Dict[index]) {
                        const videoUrl = `myprotocol:/${index}.MP4?timestamp=${Date.now()}`;
                        mainWindow.webContents.send('set-video-path', `${videoUrl}`);
                        callback({cancel: true});
                    } else if (JPGDict[index]) {
                        mainWindow.webContents.send('set-video-path', '');
                        callback({redirectURL: `myprotocol:/${index}.JPG`});
                    } else if (PNGDict[index]) {
                        mainWindow.webContents.send('set-video-path', '');
                        callback({redirectURL: `myprotocol:/${index}.PNG`});
                    } else {
                        mainWindow.webContents.send('set-video-path', '');
                        callback({});
                    }
                } catch (error) {
                    console.error('Error checking file existence:', error);
                    callback({});
                }
            } else {
                callback({});
            }
        } else {
            callback({});
        }
    }
    // 在 ses.webRequest.onBeforeRequest 中执行
    ses.webRequest.onBeforeRequest((details, callback) => {
        processRequest(details, callback).catch(error => console.error('Error processing request:', error));
    });
};
