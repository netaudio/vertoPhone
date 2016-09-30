/**
 * Created by igor on 29.09.16.
 */

class Session {
	constructor (options = {}) {

        this.lastCallNumber = null;
        this.activeCalls = {};
        this.videoParams = {};

        this.vertoLogin = options.login;
        this.cidName = options.cidName || this.vertoLogin;
        this.cidNnumber = options.cidNnumber || this.vertoLogin;

        this.notificationMissed = options.notificationMissed;
        this.notificationNewCall = options.notificationNewCall;

        if (options.ring) {
            this.ring = 'sound/iphone.mp3';
        }

        this.selectedVideo = options.selectedVideo;
        this.selectedSpeaker = options.selectedSpeaker;
        this.selectedAudio = options.selectedAudio;

        this.useVideo = options.useVideo;

        this.alwaysOnTop = options.alwaysOnTop || false;


        if (Helper.videoParamsBest[this.selectedVideo]) {
            this.videoParams = {
                minWidth: Helper.videoParamsBest[this.selectedVideo].w,
                minHeight: Helper.videoParamsBest[this.selectedVideo].h,
                maxWidth: Helper.videoParamsBest[this.selectedVideo].w,
                maxHeight: Helper.videoParamsBest[this.selectedVideo].h,
                // TODO move conf
                minFrameRate: 15
            }
        }

        this.isLogin = false;

        // TODO
        this._settings = options;

        this.verto = new $.verto({
            login: options.login,
            passwd: options.password,
            socketUrl: options.server,
            ringFile: this.ring,
            useCamera: this.selectedVideo,
            useSpeak: this.selectedSpeaker,
            useMic: this.selectedAudio,
            videoParams: this.videoParams,
            sessid: options.sessid,
            iceServers: options.iceServers
        }, this.vetoCallbacks);
        this.verto.login();
    }

    get vetoCallbacks () {
        // TODO move helper ?
        function addVideo(id) {
            var video = document.createElement('video');
            video.id = id;
            video.volume = 1;
            video.style.display = 'none';
            document.body.appendChild(video);
            return video
        }

        return {
            onRemoteStream: (d) => {
                const call = this.activeCalls[d.callID];
                if (call) {
                    call.initRemoteStream = true;
                    Helper.sendSession('changeCall', this.activeCalls);
                }
            },

            onGetVideoContainer: (d) => {
                const video = addVideo(d.callID);
                d.params.tag = video.id;
            },

            onWSLogin: (e, success) => {
                console.info('onWSLogin', e, success);
                this.isLogin = success;
                if (success) {
                    Helper.createNotificationMsg(
                        'Login', 
                        'Success', 
                        'login ' + this.vertoLogin, 
                        'images/bell64.png', 
                        2000
                    );
                    this.sendLoginToExtension();
                } else {
                    Helper.createNotificationMsg(
                        'Login', 
                        'Error', 
                        'bad credentials ' + this.vertoLogin, 
                        'images/error64.png', 
                        10000
                    )
                }

                Helper.sendSession('onWSLogin', {
                    login: this.vertoLogin,
                    success: success,
                    settings: this._settings
                });                
            },

            onWSClose: (e) => {
                console.info('onWSClose');
                console.info(e);
                this.isLogin = false;
                this.sendLogoutToExtension();                
            },

            // TODO;
            onDialogState: (d) => {
                const screenShare = /^(\d+).*-screen$/.exec(d.params.destination_number || d.params.remote_caller_id_number);

                if (screenShare) {
                    const number = screenShare[1];
                    for (let key in this.activeCalls) {
                        if (this.activeCalls[key].calleeIdNumber === number) {
                            d.screenShare = true;
                            if (d.state == $.verto.enum.state.ringing) {
                                d.answer({useVideo: true});
                            } else if (d.state == $.verto.enum.state.answering) {
                                this.activeCalls[key].setScreenShareCall(d);
                                return Helper.sendSession('changeCall', this.activeCalls);
                            } else if (d.state == $.verto.enum.state.requesting) {
                                this.activeCalls[key].setScreenShareCall(d);
                                return Helper.sendSession('changeCall', this.activeCalls);
                            } else if (d.state == $.verto.enum.state.destroy) {
                                this.activeCalls[key].removeScreenShareCall(d);
                                Helper.sendSession('changeCall', this.activeCalls);
                                d.rtc.stop();
                            }
                            return;
                        }
                    }
                    console.error('WTF screen');
                } else {
                    switch (d.state) {
                        case $.verto.enum.state.recovering:
                        case $.verto.enum.state.ringing:
                        case $.verto.enum.state.requesting:
                            if (Object.keys(this.activeCalls).length >= maxCallCount) {
                                d.hangup();
                                return;
                            }
                            d.createdOn = Date.now();
                            this.activeCalls[d.callID] = new Call(d);
                            break;
                        case $.verto.enum.state.active:
                            const dialogs = this.verto.dialogs;
                            for (let key in dialogs) {
                                if (key != d.callID
                                    && dialogs.hasOwnProperty(key)
                                    && dialogs[key].state == $.verto.enum.state.active
                                    && !dialogs[key].screenShare
                                ) {
                                    dialogs[key].hold();
                                }
                            }
                        case $.verto.enum.state.trying:
                        case $.verto.enum.state.held:
                            if (this.activeCalls.hasOwnProperty(d.callID)) {
                                this.activeCalls[d.callID].setState(d.state.name)
                            }
                            break;
                        case $.verto.enum.state.hangup:
                        case $.verto.enum.state.destroy:
                            const videoTag = document.getElementById(d.callID);
                            if (videoTag) {
                                videoTag.src = "";
                                videoTag.remove();
                            }
                            if (this.activeCalls[d.callID]) {
                                modelVerto.add('history', {
                                    createdOn: d.createdOn,
                                    answeredOn: this.activeCalls[d.callID].onActiveTime,
                                    hangupOn: Date.now(),
                                    endCause: d.cause,
                                    number: d.params.remote_caller_id_number,
                                    name: this.activeCalls[d.callID].contact && this.activeCalls[d.callID].contact.name,
                                    direction: d.direction.name
                                }, (err) => {
                                    if (err)
                                        console.error(err);
                                });
                                if (this.activeCalls[d.callID]) {
                                    this.activeCalls[d.callID].destroy(d.userDropCall);
                                    delete this.activeCalls[d.callID];
                                }
                            }
                            break;
                        default:
                            console.warn('No handle: ', d.state);
                            this.activeCalls[d.callID].setState(d.state.name);

                    }

                    console.log(this.activeCalls);
                    Helper.sendSession('changeCall', this.activeCalls);
                }
            }

        }
    }

    logout () {
        try {
            this.verto.logout();
        } catch (e) {
            console.log(e);
        }
        return true;
    }

    getLastCallNumber () {
        return this.lastCallNumber || "";
    }

    sendLoginToExtension () {
        if (Helper.extensionPort && this.isLogin) {
            Helper.extensionPort.postMessage({
                action: "login",
                data: {}
            });
        }
    }

    refreshDevicesList () {
        $.verto.init({skipPermCheck: true}, ()=> {});
    }

    getDevicesList () {
        return {
            audioInDevices: $.verto.audioInDevices,
            audioOutDevices: $.verto.audioOutDevices,
            videoDevices: $.verto.videoDevices
        }
    }

    // region call controll

    makeCall (number, option = {}) {
        this.lastCallNumber = number;
        this.verto.newCall({
            destination_number: number,
            caller_id_name: this.cidName,
            caller_id_number: this.cidNnumber,

            useVideo: this.useVideo && option.useVideo,

            useCamera: this.selectedVideo,
            useSpeak: this.selectedSpeaker,
            useMic: this.selectedAudio

            // TODO Move settings
            // useStereo: false,
            // dedEnc: false,
            // mirrorInput: false,
            // userVariables: {
            //  avatar: '',
            //  email: '@',
            // }

        });
    }

    screenShare (parentCallId) {
        const call = this.activeCalls[parentCallId];
        if (!call) {
            return // ERROR
        }

        if (call.screenShareCall) {
            this.verto.dialogs[call.screenShareCall].hangup();
            return
        }

        this.verto.newCall({
            destination_number: call.calleeIdNumber + '-screen',
            caller_id_name: this.cidName,
            caller_id_number: this.cidNnumber,
            useAudio: false,
            useStereo: false,
            useVideo: true,
            screenShare: true
        });
    }

    getCallStream (id) {
        const call = this.verto.dialogs[id];
        if (call) {
            return {
                localStream: call.rtc.localStream,
                remoteStream: call.rtc.remoteStream
            }
        }
    }

    dropCall (id) {
        const call = this.verto.dialogs[id];
        if (call) {
            call.userDropCall = true;
            call.hangup();
        }
    }

    answerCall (id, params) {
        const d = this.verto.dialogs[id];
        const call = this.activeCalls[id];
        if (d && call && !call.onActiveTime) {
            d.answer({
                useVideo: params && params.useVideo,
                callee_id_name: this.cidName,
                callee_id_number: this.cidNnumber
                //  TODO move to conf		
                // useStereo: false	
            });
        }
    }

    holdCall (id) {
        const call = this.verto.dialogs[id];
        if (call) {
            call.hold();
        }        
    }

    unholdCall (id) {
        const call = this.verto.dialogs[id];
        if (call) {
            call.unhold();
        }        
    }

    toggleHold (id) {
        const call = this.verto.dialogs[id];
        if (call) {
            call.toggleHold();
        }        
    }

    dtmf (id, digit) {
        const call = this.verto.dialogs[id];
        if (call) {
            call.dtmf(digit);
        }        
    }

    transfer (id, dest, params = {}) {
        const dialog = this.verto.dialogs[id];
        if (dialog)
            dialog.transfer(dest, params);        
    }

    toggleMute (id) {
        const call = this.activeCalls[id],
            dialog = this.verto.dialogs[id]
            ;

        if (call && dialog) {
            call.setMute(dialog.setMute('toggle'));
            Helper.sendSession('changeCall', this.activeCalls);
        }        
    }

    // endregion

}