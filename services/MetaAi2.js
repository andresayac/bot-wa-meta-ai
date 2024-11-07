import { v4 as uuidv4 } from 'uuid'
import fs from 'fs'

const url = 'https://graph.meta.ai/graphql?locale=user'
const cookies_url = 'https://www.meta.ai/'
const access_token_url = 'https://www.meta.ai/api/graphql'

const sleep = async (ms) => {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

const DEFAULT_HEADERS = {
    accept: '*/*',
    'accept-encoding': 'gzip, deflate',
    'accept-language': 'en-US',
    referer: '',
    'sec-ch-ua': '"Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"',
    'sec-ch-ua-arch': '"x86"',
    'sec-ch-ua-bitness': '"64"',
    'sec-ch-ua-full-version': '"123.0.6312.122"',
    'sec-ch-ua-full-version-list':
        '"Google Chrome";v="123.0.6312.122", "Not:A-Brand";v="8.0.0.0", "Chromium";v="123.0.6312.122"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-model': '""',
    'sec-ch-ua-platform': '"Windows"',
    'sec-ch-ua-platform-version': '"15.0.0"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
}

function binaryToDecimal(data) {
    let ret = ''
    while (data !== '0') {
        let end = 0
        let fullName = ''
        let i = 0
        for (; i < data.length; i++) {
            end = 2 * end + parseInt(data[i], 10)
            if (end >= 10) {
                fullName += '1'
                end -= 10
            } else {
                fullName += '0'
            }
        }
        ret = end.toString() + ret
        data = fullName.slice(fullName.indexOf('1'))
    }
    return ret
}

const generateOfflineThreadingID = () => {
    const now = Date.now()
    const rand = Math.floor(Math.random() * 4294967295)
    const str = ('0000000000000000000000' + rand.toString(2)).slice(-22)
    const msgs = now.toString(2) + str
    return binaryToDecimal(msgs)
}

const extractValue = (text, key = null, startStr = null, endStr = '",') => {
    if (!startStr) {
        startStr = `${key}":{"value":"`
    }
    let start = text.indexOf(startStr)
    if (start >= 0) {
        start += startStr.length
        const end = text.indexOf(endStr, start)
        if (end >= 0) {
            return text.substring(start, end)
        }
    }
    return null
}

const formatCookies = (cookies) => {
    return Object.entries(cookies)
        .map(([key, value]) => `${key}=${value}`)
        .join('; ')
}

class MetaAI {
    constructor() {
        this.name = 'MetaAI'
        this.externalConversationId = uuidv4()
        this.accessToken = null
        this.lsd = null
        this.cookies = null
    }

    async updateCookies() {
        const response = await fetch(cookies_url, {
            method: 'GET',
            headers: DEFAULT_HEADERS,
        })

        const text = await response.text()
        this.cookies = {
            _js_datr: extractValue(text, '_js_datr'),
            abra_csrf: extractValue(text, 'abra_csrf'),
            datr: extractValue(text, 'datr'),
        }
        this.lsd = extractValue(text, null, '"LSD",[],{"token":"', '"}')
    }

    async updateAccessToken(birthday = '1990-01-01') {
        const payload = {
            lsd: this.lsd,
            fb_api_caller_class: 'RelayModern',
            fb_api_req_friendly_name: 'useAbraAcceptTOSForTempUserMutation',
            variables: JSON.stringify({
                dob: birthday,
                icebreaker_type: 'TEXT_V2',
                __relay_internal__pv__WebPixelRatiorelayprovider: 1,
            }),
            doc_id: '8631373360323878',
        }
        const headers = {
            ...DEFAULT_HEADERS,
            'x-fb-friendly-name': 'useAbraAcceptTOSForTempUserMutation',
            'x-fb-lsd': this.lsd,
            'x-asbd-id': '129477',
            'alt-used': 'www.meta.ai',
            'sec-fetch-site': 'same-origin',
            cookie: formatCookies(this.cookies),
        }
        const response = await fetch(access_token_url, {
            method: 'POST',
            headers: headers,
            body: new URLSearchParams(payload),
        })

        const text = await response.text()

        const [firstJsonText] = text.split(/(?=\{"label":)/)

        try {
            const firstJson = JSON.parse(firstJsonText)
            this.accessToken = firstJson?.data?.xab_abra_accept_terms_of_service?.new_temp_user_auth?.access_token
        } catch (error) {
            console.error('Error parsing JSON', error)
        }
    }

    async *prompt(message) {
        if (!this.cookies) await this.updateCookies()
        if (!this.accessToken) await this.updateAccessToken()

        await sleep(500)

        const headers = this.buildHeaders()
        const payload = this.buildPayload(message)

        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: new URLSearchParams(payload),
        })

        const reader = response.body.getReader()
        let prevLine = ''
        let lastSnippetLen = 0

        while (true) {
            const { done, value } = await reader.read()
            if (done) break

            let line = this.decodeLine(value, prevLine)
            if (!line) continue

            prevLine = ''

            const botResponseMessage = line?.data?.node?.bot_response_message || {}
            if (this.isValidBotResponse(botResponseMessage)) {
                const snippet = botResponseMessage.snippet
                const newSnippetLen = snippet.length
                if (newSnippetLen > lastSnippetLen) {
                    yield snippet.substring(lastSnippetLen)
                    lastSnippetLen = newSnippetLen
                }
            }
        }
    }

    // Construcción de los encabezados
    buildHeaders() {
        return {
            ...DEFAULT_HEADERS,
            'content-type': 'application/x-www-form-urlencoded',
            cookie: this.formatCookies(this.cookies),
            origin: 'https://www.meta.ai',
            referer: 'https://www.meta.ai/',
            'x-asbd-id': '129477',
            'x-fb-friendly-name': 'useAbraSendMessageMutation',
        }
    }

    // Construcción de la carga útil (payload)
    buildPayload(message) {
        return {
            access_token: this.accessToken,
            fb_api_caller_class: 'RelayModern',
            fb_api_req_friendly_name: 'useAbraSendMessageMutation',
            variables: JSON.stringify({
                message: { sensitive_string_value: message },
                externalConversationId: this.externalConversationId,
                offlineThreadingId: generateOfflineThreadingID(),
                suggestedPromptIndex: null,
                flashPreviewInput: null,
                promptPrefix: null,
                entrypoint: 'ABRA__CHAT__TEXT',
                icebreaker_type: 'TEXT_V2',
                __relay_internal__pv__AbraDebugDevOnlyrelayprovider: false,
                __relay_internal__pv__WebPixelRatiorelayprovider: 1,
            }),
            server_timestamps: 'true',
            doc_id: '8544224345667255',
        }
    }

    // Decodificación de la línea y manejo de errores
    decodeLine(value, prevLine) {
        let line = new TextDecoder().decode(value)
        try {
            return JSON.parse(line)
        } catch {
            // Si no es JSON, intentar concatenarlo con la línea previa
            prevLine += line
            try {
                return JSON.parse(prevLine)
            } catch {
                return null
            }
        }
    }

    // Verificación de una respuesta válida del bot
    isValidBotResponse(botResponseMessage) {
        return (
            botResponseMessage.streaming_state === 'OVERALL_DONE' || botResponseMessage.streaming_state === 'STREAMING'
        )
    }

    sendMessage = async (
        message,
        options = {
            model: 'meta-llama-3',
            history: [],
            onProgress: () => {},
        },
    ) => {
        if (options.history) {
            options.history = options.history.map((item) => {
                return { role: item.role, content: item.content }
            })
        }
        const prompt = [{ role: 'user', content: message }]
        const generator = this.generate(prompt, options, { max_retries: 5 })
        let response = ''
        for await (const partialResponse of generator) {
            options.onProgress(partialResponse)
            response += partialResponse
        }

        return response
    }

    messages_to_json = (chat, { readFiles = true } = {}) => {
        let json = []

        for (let i = 0; i < chat.length; i++) {
            let message = { role: chat[i].role.toLowerCase(), content: chat[i].content }
            if (chat[i].role.toLowerCase() === 'user') {
                const { files } = chat[i]
                message.content = chat[i].content || ''
                if (files?.length && readFiles) {
                    message.files = []
                    for (const file of files) {
                        if (file.file_path) {
                            const contents = fs.readFileSync(file.file_path, 'utf8')
                            message.files.push({ file_name: file.file_name, content: contents })
                        }
                    }
                }
            }
            json.push(message)
        }

        return json
    }

    format_chat_to_prompt = (chat, { model = null, assistant = true } = {}) => {
        chat = this.messages_to_json(chat)
        model = model?.toLowerCase() || ''
        let prompt = ''

        if (model.includes('meta-llama-3')) {
            prompt += '<|begin_of_text|>'
            for (let i = 0; i < chat.length; i++) {
                prompt += `<|start_header_id|>${chat[i].role}<|end_header_id|>`
                prompt += `\n${chat[i].content}<|eot_id|>`
            }
            if (assistant) prompt += '<|start_header_id|>assistant<|end_header_id|>'
        } else {
            for (let i = 0; i < chat.length; i++) {
                prompt += this.capitalize(chat[i].role) + ': ' + chat[i].content + '\n'
            }
            if (assistant) prompt += 'Assistant:'
        }

        return prompt
    }

    format_chat_to_prompt = (chat, { model = null, assistant = true } = {}) => {
        chat = this.messages_to_json(chat)
        model = model?.toLowerCase() || ''
        let prompt = ''

        if (model.includes('meta-llama-3')) {
            prompt += '<|begin_of_text|>'
            for (let i = 0; i < chat.length; i++) {
                prompt += `<|start_header_id|>${chat[i].role}<|end_header_id|>`
                prompt += `\n${chat[i].content}<|eot_id|>`
            }
            if (assistant) prompt += '<|start_header_id|>assistant<|end_header_id|>'
        } else {
            for (let i = 0; i < chat.length; i++) {
                prompt += this.capitalize(chat[i].role) + ': ' + chat[i].content + '\n'
            }
            if (assistant) prompt += 'Assistant:'
        }

        return prompt
    }

    async *generate(chat, options, { max_retries = 5 }) {
        try {
            const chatPrompt = this.format_chat_to_prompt(chat)
            yield* this.prompt(chatPrompt)
        } catch (e) {
            if (max_retries > 0) {
                console.log(e, 'Retrying...')
                yield* this.generate(chat, options, { max_retries: max_retries - 1 })
            } else {
                console.error(e)
                throw e
            }
        }
    }

    capitalize = (str) => str.charAt(0).toUpperCase() + str.slice(1)

    formatCookies = (cookies) => {
        return Object.entries(cookies)
            .map(([key, value]) => `${key}=${value}`)
            .join('; ')
    }
}

const main = async () => {
    const metaDev = new MetaAI()
    const response = await metaDev.sendMessage('Puedes generar la imagen de un gato tomando el sol', {
        model: 'meta-llama-3',
        onProgress: (token) => {
            //console.log(token)
        },
    })

    console.log(response)

}

main()

export { MetaAI }
