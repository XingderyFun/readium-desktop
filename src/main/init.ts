// ==LICENSE-BEGIN==
// Copyright 2017 European Digital Reading Lab. All rights reserved.
// Licensed to the Readium Foundation under one or more contributor license agreements.
// Use of this source code is governed by a BSD-style license
// that can be found in the LICENSE file exposed on Github (readium) in the project repository.
// ==LICENSE-END=

import * as debug_ from "debug";
import { app, protocol } from "electron";
import * as path from "path";
import { syncIpc, winIpc } from "readium-desktop/common/ipc";
import { ReaderMode } from "readium-desktop/common/models/reader";
import { AppWindow, AppWindowType } from "readium-desktop/common/models/win";
import {
    i18nActions, netActions, readerActions, updateActions,
} from "readium-desktop/common/redux/actions";
import { setLocale } from "readium-desktop/common/redux/actions/i18n";
import { NetStatus } from "readium-desktop/common/redux/states/net";
import { AvailableLanguages } from "readium-desktop/common/services/translator";
import { ConfigRepository } from "readium-desktop/main/db/repository/config";
import { container } from "readium-desktop/main/di";
import { appInit } from "readium-desktop/main/redux/actions/app";
import { RootState } from "readium-desktop/main/redux/states";
import { WinRegistry } from "readium-desktop/main/services/win-registry";
import { PublicationStorage } from "readium-desktop/main/storage/publication-storage";
import { Store } from "redux";

import { ReaderStateConfig, ReaderStateMode, ReaderStateReader } from "readium-desktop/main/redux/states/reader";

import { UpdateState } from "readium-desktop/common/redux/states/update";

// Logger
const debug = debug_("readium-desktop:main");

// Callback called when a window is opened
const winOpenCallback = (appWindow: AppWindow) => {
    // Send information to the new window
    const store = container.get("store") as Store<RootState>;
    const webContents = appWindow.win.webContents;

    // Send the id to the new window
    webContents.send(winIpc.CHANNEL, {
        type: winIpc.EventType.IdResponse,
        payload: {
            winId: appWindow.identifier,
        },
    } as winIpc.EventPayload);

    // Init network on window
    const state = store.getState();
    let netActionType = null;

    switch (state.net.status) {
        case NetStatus.Online:
            netActionType = netActions.ActionType.Online;
            break;
        case NetStatus.Online:
            netActionType = netActions.ActionType.Offline;
            break;
    }

    // Send network status
    webContents.send(syncIpc.CHANNEL, {
        type: syncIpc.EventType.MainAction,
        payload: {
            action: {
                type: netActionType,
            },
        },
    } as syncIpc.EventPayload);

    // Send reader information
    webContents.send(syncIpc.CHANNEL, {
        type: syncIpc.EventType.MainAction,
        payload: {
            action: {
                type: readerActions.ActionType.OpenSuccess,
                payload: {
                    reader: state.reader.readers[appWindow.identifier],
                } as ReaderStateReader,
            },
        },
    } as syncIpc.EventPayload);

    // Send reader config
    webContents.send(syncIpc.CHANNEL, {
        type: syncIpc.EventType.MainAction,
        payload: {
            action: {
                type: readerActions.ActionType.ConfigSetSuccess,
                payload: {
                    config: state.reader.config,
                } as ReaderStateConfig,
            },
        },
    } as syncIpc.EventPayload);

    // Send reader mode
    webContents.send(syncIpc.CHANNEL, {
        type: syncIpc.EventType.MainAction,
        payload: {
            action: {
                type: readerActions.ActionType.ModeSetSuccess,
                payload: {
                    mode: state.reader.mode,
                } as ReaderStateMode,
            },
        },
    } as syncIpc.EventPayload);

    // Send locale
    webContents.send(syncIpc.CHANNEL, {
        type: syncIpc.EventType.MainAction,
        payload: {
            action: {
                type: i18nActions.ActionType.Set,
                payload: {
                    locale: state.i18n.locale,
                } as i18nActions.PayloadLocale,
            },
        },
    } as syncIpc.EventPayload);

    // Send locale
    webContents.send(syncIpc.CHANNEL, {
        type: syncIpc.EventType.MainAction,
        payload: {
            action: {
                type: updateActions.ActionType.LatestVersionSet,
                payload: {
                    status: state.update.status,
                    latestVersion: state.update.latestVersion,
                    latestVersionUrl: state.update.latestVersionUrl,
                } as UpdateState,
            },
        },
    } as syncIpc.EventPayload);
};

// Callback called when a window is closed
const winCloseCallback = (appWindow: AppWindow) => {
    const store = container.get("store") as Store<RootState>;
    const winRegistry = container.get("win-registry") as WinRegistry;
    const appWindows = winRegistry.getWindows();

    // if multiple windows are open & library are closed. all other windows are closed
    if (Object.keys(appWindows).length >= 1 &&
        appWindow.type === AppWindowType.Library) {
        for (let nbWindow = Object.keys(appWindows).length - 1;
            nbWindow >= 0; nbWindow--) {
            Object.values(appWindows)[nbWindow].win.close();
        }
        return;
    }

    if (Object.keys(appWindows).length !== 1) {
        return;
    }

    const appWin = Object.values(appWindows)[0];
    if (appWin.type === AppWindowType.Library) {
        // Set reader to attached mode
        store.dispatch({
            type: readerActions.ActionType.ModeSetSuccess,
            payload: {
                mode: ReaderMode.Attached,
            },
        });
    }

    if (
        appWin.type === AppWindowType.Library &&
        !appWin.win.isVisible()
    ) {
        // Library window is hidden
        // There is no more opened window
        // Consider that we close application
        Object.values(appWindows)[0].win.close();

    }
};

// Initialize application
export function initApp() {
    const store = container.get("store") as Store<RootState>;
    store.dispatch(appInit());

    const configRepository: ConfigRepository = container.get("config-repository") as ConfigRepository;
    configRepository.get("i18n").then((i18nLocale) => {
        if (i18nLocale && i18nLocale.value && i18nLocale.value.locale) {
            store.dispatch(setLocale(i18nLocale.value.locale));
            debug(`set the locale ${i18nLocale.value.locale}`);
        } else {
            debug(`error on configRepository.get("i18n")): ${i18nLocale}`);
        }
    }).catch(async () => {
        const loc = app.getLocale().split("-")[0];
        const lang = Object.keys(AvailableLanguages).find((l) => l === loc) || "en";
        store.dispatch(setLocale(lang));
        debug(`create i18n key in configRepository with ${lang} locale`);
    });

    const winRegistry = container.get("win-registry") as WinRegistry;
    winRegistry.registerOpenCallback(winOpenCallback);
    winRegistry.registerCloseCallback(winCloseCallback);
    app.setAppUserModelId("io.github.edrlab.thorium");
}

export function registerProtocol() {
    protocol.registerFileProtocol("store", (request, callback) => {
        // Extract publication item relative url
        const relativeUrl = request.url.substr(6);
        const pubStorage: PublicationStorage = container.get("publication-storage") as PublicationStorage;
        const filePath: string = path.join(pubStorage.getRootPath(), relativeUrl);
        callback(filePath);
    });
}