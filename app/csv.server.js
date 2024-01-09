// csv.server.js (in /app)

const extractValues = (text) => {
    const parseOfStr = text.split('\n');
    
    parseOfStr.splice(0, 6); // remove formatting at beginning of file + first line of CSV (not relevant)
    parseOfStr.splice(parseOfStr.length - 3, 3); // remove formatting at end of file

    let rows = parseOfStr.map((row) => {
        const r = row.split(';');
        if (r[1]) {
            const nameAndOrder = extractNameAndOrderId(r[1]);
            const credit = typeof(r[3]) === 'string' ? r[3].trim() : r[3];
            return {
                date: r[0],
                name: nameAndOrder.name,
                order: nameAndOrder.orderId,
                credit,
            }
        } else {
            return false;
        }
    });

    return rows;
}

const extractNameAndOrderId = (text) => {
    if (text !== undefined) {
        const nameRegex = /PAR(.*?)(:|$)/g;
        const dirtyOrderRegex = /:(.*)$/;
        const orderRegex = /[a-zA-Z0-9]+/g;
        const name = [];

        while ((match = nameRegex.exec(text)) !== null) {
            if (match[1].trim()) {
                name.push(match[1].trim());
            }
        }

        const matchOrder = text.match(dirtyOrderRegex);
        const dirtyOrderId = matchOrder ? matchOrder[1].trim() : null;
        const orderId = dirtyOrderId ? dirtyOrderId.match(orderRegex)[0].trim() : null;

        return {
            name: name[0],
            orderId: orderId
        }
    }
    return "";

}

export const parseCSV = (stream) => {
    return new Promise( async (resolve, reject) => {
        const reader = stream.body.getReader();
        let text = '';
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            text += new TextDecoder().decode(value);
        }
        const extractedValues = extractValues(text);
        resolve(extractedValues);
    });
}