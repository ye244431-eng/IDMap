import { LUNAR_NEW_YEAR, ZODIAC_ANIMALS, ZODIAC_RANGES } from '../data/calendar-data.js';
import { CITY_MAP, MUNICIPALITY_CODES, PROVINCE_MAP, SPECIAL_REGION_CODES } from '../data/region-data.js';

export class IDCardParser {
    static CHECK_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
    static CHECK_CODES = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];

    constructor(rawId) {
        this.rawId = (rawId || '').trim().toUpperCase();
        this._valid = false;
        this._error = '';
        this._provinceCode = '';
        this._cityCode = '';
        this._countyCode = '';
        this._birthDate = null;
        this._genderCode = -1;
        this._parse();
    }

    _parse() {
        const id = this.rawId;
        if (id.length !== 18) {
            this._error = '身份证号码必须为18位';
            return;
        }
        if (!/^\d{17}[\dX]$/.test(id)) {
            this._error = '身份证号码格式不正确（前17位为数字，第18位为数字或X）';
            return;
        }

        let sum = 0;
        for (let i = 0; i < 17; i += 1) {
            sum += parseInt(id[i], 10) * IDCardParser.CHECK_WEIGHTS[i];
        }
        if (IDCardParser.CHECK_CODES[sum % 11] !== id[17]) {
            this._error = '身份证号码校验码不正确，请检查输入';
            return;
        }

        const year = parseInt(id.substring(6, 10), 10);
        const month = parseInt(id.substring(10, 12), 10);
        const day = parseInt(id.substring(12, 14), 10);
        const date = new Date(year, month - 1, day);
        if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
            this._error = '身份证中的出生日期不合法';
            return;
        }
        if (year < 1900 || year > new Date().getFullYear()) {
            this._error = '身份证中的出生年份不在合理范围内';
            return;
        }

        this._provinceCode = id.substring(0, 2);
        this._cityCode = id.substring(0, 4);
        this._countyCode = id.substring(0, 6);

        const provinceExists = PROVINCE_MAP[this._provinceCode];
        const isSpecial = SPECIAL_REGION_CODES.includes(this._provinceCode);
        if (!provinceExists && !isSpecial) {
            this._error = '身份证号码中的地区代码不合法';
            return;
        }

        this._birthDate = date;
        this._genderCode = parseInt(id[16], 10);
        this._valid = true;
    }

    isValid() { return this._valid; }
    getError() { return this._error; }
    getProvinceCode() { return this._provinceCode; }
    getCityCode() { return this._cityCode; }
    getCountyCode() { return this._countyCode; }
    getBirthDate() { return this._birthDate; }
    getGenderCode() { return this._genderCode; }

    getProvinceName() {
        return PROVINCE_MAP[this._provinceCode] || '未知省份';
    }

    getCityName() {
        return CITY_MAP[this._cityCode] || '';
    }

    getFullAncestralHome(resolvedLocation = {}) {
        const provinceName = this.getProvinceName();
        if (resolvedLocation.provinceOnly) return provinceName;

        const cityName = resolvedLocation.cityName || this.getCityName();
        const countyName = resolvedLocation.countyName || '';

        if (MUNICIPALITY_CODES.includes(this._provinceCode)) {
            if (countyName) return `${provinceName} ${countyName}`;
            return cityName && cityName !== provinceName ? `${provinceName} ${cityName}` : provinceName;
        }
        if (cityName) {
            return `${provinceName} ${cityName}`;
        }
        if (countyName) {
            return `${provinceName} ${countyName}`;
        }
        return provinceName;
    }
}

export class PersonalInfo extends IDCardParser {
    getZodiacSign() {
        const birthDate = this.getBirthDate();
        if (!birthDate) return null;

        const month = birthDate.getMonth() + 1;
        const day = birthDate.getDate();
        const md = month * 100 + day;

        for (const zodiac of ZODIAC_RANGES) {
            const [startMonth, startDay] = zodiac.start;
            const [endMonth, endDay] = zodiac.end;
            const start = startMonth * 100 + startDay;
            const end = endMonth * 100 + endDay;
            if (start <= end) {
                if (md >= start && md <= end) return zodiac.name;
            } else if (md >= start || md <= end) {
                return zodiac.name;
            }
        }

        return '未知';
    }

    getGender() {
        const genderCode = this.getGenderCode();
        if (genderCode < 0) return '未知';
        return genderCode % 2 === 1 ? '男' : '女';
    }

    getChineseZodiac() {
        const birthDate = this.getBirthDate();
        if (!birthDate) return null;

        const year = birthDate.getFullYear();
        const month = birthDate.getMonth() + 1;
        const day = birthDate.getDate();
        let zodiacYear = year;
        const springFestival = LUNAR_NEW_YEAR[year];

        if (springFestival) {
            if (month < springFestival[0] || (month === springFestival[0] && day < springFestival[1])) {
                zodiacYear = year - 1;
            }
        } else if (month < 2 || (month === 2 && day < 4)) {
            zodiacYear = year - 1;
        }

        const index = ((zodiacYear - 4) % 12 + 12) % 12;
        return ZODIAC_ANIMALS[index];
    }

    getSummary(resolvedLocation = {}) {
        return {
            ancestralHome: this.getFullAncestralHome(resolvedLocation),
            zodiacSign: this.getZodiacSign() || '——',
            gender: this.getGender(),
            chineseZodiac: this.getChineseZodiac() || '——',
            provinceCode: this.getProvinceCode(),
            cityCode: this.getCityCode(),
            countyCode: this.getCountyCode(),
            provinceName: this.getProvinceName(),
            cityName: resolvedLocation.cityName || this.getCityName(),
            countyName: resolvedLocation.countyName || '',
            birthDate: this.getBirthDate(),
        };
    }
}
