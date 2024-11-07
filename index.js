/* eslint-disable complexity */
import { createBot, createProvider, createFlow, addKeyword, utils, EVENTS } from '@builderbot/bot'
import { MemoryDB as Database } from '@builderbot/bot'
import { BaileysProvider as Provider } from '@builderbot/provider-baileys'

import dotenv from 'dotenv-safe'
import { oraPromise } from 'ora'
import PQueue from 'p-queue'
import { processAudioToText, textToAudio } from './services/Huggingface.js'
import {
    isAudio,
    isImage,
    isPdf,
    isPdfWithCaption,
    simulateTyping,
    simulateEndPause,
    formatTextWithLinks,
    parseLinksWithText,
    timeout,
    divideTextInTokens,
    filterText,
} from './utils/index.js'
import { downloadMediaMessage } from '@whiskeysockets/baileys'
import { MetaAI } from './services/MetaAI.js'
import { pdfToText } from './services/PdfToText.js'
import { textToSpeech } from './services/TextToSpeech.js'
import languages from './languages.js'

dotenv.config({
    allowEmptyValues: true,
})

const languageBot = languages[process.env.BOT_LANGUAGE ?? 'es']
const systemMessage = process.env.META_AI_SYSTEM_MESSAGE ?? '🤖'
const allMessagesWithAudio = process.env.BOT_ALL_MSG_WITH_AUDIO === 'true'

const maxTimeQueue = 600000
const queue = new PQueue({ concurrency: 3 })
const PORT = process.env.PORT ?? 3008

const flowBotImage = addKeyword(EVENTS.MEDIA).addAction(async (ctx, { gotoFlow }) => {
    gotoFlow(flowBotWelcome)
})

const flowBotDoc = addKeyword(EVENTS.DOCUMENT).addAction(async (ctx, { gotoFlow }) => {
    gotoFlow(flowBotWelcome)
})

const flowBotAudio = addKeyword(EVENTS.VOICE_NOTE).addAction(async (ctx, { gotoFlow }) => {
    gotoFlow(flowBotWelcome)
})

const flowBotLocation = addKeyword(EVENTS.LOCATION).addAction(async (ctx, { flowDynamic }) => {
    flowDynamic(languageBot.notAllowLocation)
})

const flowBotWelcome = addKeyword(EVENTS.WELCOME).addAction(
    async (ctx, { fallBack, flowDynamic, endFlow, gotoFlow, provider, state }) => {
        // Simulate typing
        await simulateTyping(ctx, provider)

        if (state.getMyState()?.finishedAnswer === false) {
            flowDynamic(languageBot.oneMessageAtTime)
            await fallBack()
            return
        }

        let isAudioConversation = allMessagesWithAudio
        let isPdfConversation = false
        let messageBot = null
        let messageBotTmp = ''

        if (isAudio(ctx)) {
            if (process.env.BOT_RECONGNIZE_AUDIO === 'true') {
                isAudioConversation = true
                // Process audio
                await flowDynamic(languageBot.listeningToAudio)
                const buffer = await downloadMediaMessage(ctx, 'buffer')
                const response = await processAudioToText(buffer, ctx.key.id + '.ogg')
                if (response.success) {
                    ctx.body = response.output.data[0]
                } else {
                    await flowDynamic(languageBot.errorProcessingAudio)
                    await gotoFlow(flowBotWelcome)
                    return
                }
            } else {
                await flowDynamic(languageBot.notAllowReconizeAudio)
                await fallBack()
                return
            }
        }

        let imageBase64 = null
        let context = state.getMyState()?.context ?? null

        if (isImage(ctx)) {
            if (process.env.BOT_RECONGNIZE_IMAGE === 'true') {
                messageBot = await provider.vendor.sendMessage(
                    ctx?.key?.remoteJid,
                    { text: '🔍🖼️⏳💭' },
                    { quoted: ctx },
                )
                await simulateEndPause(ctx, provider)
                await simulateTyping(ctx, provider)
                const buffer = await downloadMediaMessage(ctx, 'buffer')
                // Buffer to base64
                imageBase64 = buffer.toString('base64')
                ctx.body = ctx.message?.imageMessage?.caption ?? ''
            } else {
                await flowDynamic(languageBot.notAllowReconizeImage)
                await fallBack()
                return
            }
        }

        if (isPdf(ctx)) {
            if (process.env.BOT_RECONGNIZE_PDF === 'true') {
                isPdfConversation = true
                messageBot = await provider.vendor.sendMessage(
                    ctx?.key?.remoteJid,
                    { text: '🔍📄⏳💭' },
                    { quoted: ctx },
                )
                await simulateEndPause(ctx, provider)
                await simulateTyping(ctx, provider)
                const buffer = await downloadMediaMessage(ctx, 'buffer')
                // Buffer to base64
                ctx.body = languageBot.instructionsPdf
                const pdfText = await pdfToText(buffer)
                context = divideTextInTokens(pdfText, 10000)
                context = context[0].substring(0, 10000)

                state.update({
                    context,
                })
            } else {
                await flowDynamic(languageBot.notAllowReconizePdf)
                await fallBack()
                return
            }
        }

        if (isPdfWithCaption(ctx)) {
            if (process.env.BOT_RECONGNIZE_PDF === 'true') {
                messageBot = await provider.vendor.sendMessage(
                    ctx?.key?.remoteJid,
                    { text: '🔍📄⏳💭' },
                    { quoted: ctx },
                )
                await simulateEndPause(ctx, provider)
                await simulateTyping(ctx, provider)
                const buffer = await downloadMediaMessage(ctx, 'buffer')
                // Buffer to base64
                ctx.body =
                    ctx.message?.documentWithCaptionMessage?.message.documentMessage?.caption ??
                    languageBot.instructionsPdf
                const pdfText = await pdfToText(buffer)
                context = divideTextInTokens(pdfText, 10000)
                context = context[0].substring(0, 10000)
            } else {
                await flowDynamic(languageBot.notAllowReconizePdf)
                await fallBack()
                return
            }
        }

        if (messageBot === null) {
            messageBot = await provider.vendor.sendMessage(ctx?.key?.remoteJid, { text: '🔍⏳💭' }, { quoted: ctx })
        }

        // Restart conversation fr, es, en, zh, it, pr
        if (
            ctx.body.toLowerCase().trim().includes('/reiniciar') ||
            ctx.body.toLowerCase().trim().includes('/restart') ||
            ctx.body.toLowerCase().trim().includes('/重新开始') ||
            ctx.body.toLowerCase().trim().includes('/recommencer')
        ) {
            state.update({
                name: ctx.pushName ?? ctx.from,
                conversationBot: null,
                conversationNumber: 0,
                finishedAnswer: true,
            })

            await flowDynamic(languageBot.restartConversation)
            await simulateEndPause(ctx, provider)
            await endFlow()

            return
        }

        if (!state?.getMyState()?.conversationBot) {
            const prompt = ctx.body.trim()

            state.update({
                metaAi: new MetaAI(),
            })

            console.log(systemMessage + ' ' + prompt)

            try {
                const response = await queue.add(async () => {
                    try {
                        return await Promise.race([
                            oraPromise(
                                state.getMyState().metaAi.sendMessage(systemMessage + ' ' + prompt, {
                                    model: process.env.META_AI_MODEL ?? 'meta-llama-3',
                                    onProgress: (token) => {
                                        if (process.env.BOT_MESSAGE_ON_PROCESS === 'true') {
                                            if (token.includes('iframe')) {
                                                return
                                            }

                                            messageBotTmp += token
                                            provider.vendor.sendMessage(ctx?.key?.remoteJid, {
                                                edit: messageBot.key,
                                                text: formatTextWithLinks(messageBotTmp),
                                            })
                                        }
                                    },
                                }),
                                {
                                    text: `[${ctx.from}] - ${languageBot.waitResponse}: ` + prompt,
                                },
                            ),
                            timeout(maxTimeQueue),
                        ])
                    } catch (error) {
                        console.error(error)
                    }
                })
                await provider.vendor.sendMessage(ctx?.key?.remoteJid, {
                    edit: messageBot.key,
                    text: parseLinksWithText(response) ?? 'Error',
                })

                if (isAudioConversation && process.env.BOT_TEXT_TO_SPEECH === 'true' && response != '') {
                    state.update({
                        finishedAnswer: true,
                    })

                    const audioBuffer = await textToSpeech(filterText(response))
                    await provider.vendor.sendMessage(
                        ctx?.key?.remoteJid,
                        { audio: audioBuffer, ptt: true, mimetype: 'audio/mpeg' },
                        { quoted: ctx },
                    )
                }


                state.update({
                    conversationBot: [
                        {
                            role: 'user',
                            content: prompt,
                        },
                        {
                            role: 'assistant',
                            content: response,
                        },
                    ],
                    conversationNumber: 1,
                    finishedAnswer: true,
                })
            } catch (error) {
                state.update({ finishedAnswer: true })
                await flowDynamic('Error')
                await endFlow()
            }

            // Stop typing
            await simulateEndPause(ctx, provider)
            return
        }

        if (state.getMyState()?.conversationBot) {
            const prompt = ctx.body.trim()

            state.update({
                finishedAnswer: false,
            })

            try {
                const response = await queue.add(async () => {
                    try {
                        return await Promise.race([
                            oraPromise(
                                state.getMyState().metaAi.sendMessage(prompt, {
                                    model: process.env.META_AI_MODEL ?? 'meta-llama-3',
                                    onProgress: (token) => {
                                        if (process.env.BOT_MESSAGE_ON_PROCESS === 'true') {
                                            if (token.includes('iframe')) {
                                                return
                                            }

                                            messageBotTmp += token
                                            provider.vendor.sendMessage(ctx?.key?.remoteJid, {
                                                edit: messageBot.key,
                                                text: formatTextWithLinks(messageBotTmp),
                                            })
                                        }
                                    },
                                }),
                                {
                                    text: `[${ctx.from}] - ${languageBot.waitResponse}: ` + prompt,
                                },
                            ),
                            timeout(maxTimeQueue),
                        ])
                    } catch (error) {
                        console.error(`${languageBot.errorInBot}:`, error)
                    }
                })

                if (isAudioConversation && response != '') {
                    state.update({
                        finishedAnswer: true,
                    })

                    const audioBuffer = await textToSpeech(filterText(response))
                    await provider.vendor.sendMessage(
                        ctx?.key?.remoteJid,
                        { audio: audioBuffer, ptt: true, mimetype: 'audio/mpeg' },
                        { quoted: ctx },
                    )
                }


                await provider.vendor.sendMessage(ctx?.key?.remoteJid, {
                    edit: messageBot.key,
                    text: parseLinksWithText(response) ?? 'Error',
                })

                state.update({
                    name: ctx.pushName ?? ctx.from,
                    conversationBot: [
                        ...state.getMyState()?.conversationBot,
                        {
                            role: 'user',
                            content: prompt,
                        },
                        {
                            role: 'assistant',
                            content: response,
                        },
                    ],
                    // eslint-disable-next-line no-unsafe-optional-chaining
                    conversationNumber: state.getMyState()?.conversationNumber + 1,
                    finishedAnswer: true,
                })
            } catch (error) {
                console.error(error)
                state.update({ finishedAnswer: true })
                await flowDynamic('Error')
            }

            await simulateEndPause(ctx, provider)
        }
    },
)

const main = async () => {
    const adapterFlow = createFlow([flowBotWelcome, flowBotImage, flowBotDoc, flowBotAudio, flowBotLocation])
    const adapterProvider = createProvider(Provider, {
        useBaileysStore: false,
    })
    const adapterDB = new Database()

    const { httpServer } = await createBot({
        flow: adapterFlow,
        provider: adapterProvider,
        database: adapterDB,
    })

    httpServer(+PORT)
}

main()
