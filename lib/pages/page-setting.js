'use strict'

const SectionSetting = require('./section-setting.js')

module.exports = class ParagraphSetting extends SectionSetting {
    constructor(section, id) {
        super(section, id)
        this._type = 'PAGE'
        this._page = id
    }

    page(value) {
        this._page = value
        return this
    }

    image(value) {
        this._image = value
        return this
    }

    style(value) {
        this._style = value
        return this
    }

    toJson() {
        const result = super.toJson()
        delete result.required
        if (this._page) {
            result.page = this._page
        }

        if (this._image) {
            result.image = this._image
        }

        if (this._style) {
            result.style = this._style
        }

        return result
    }
}