'use client'

import { useEffect, useState } from 'react';
import Container from 'react-bootstrap/Container';
import { apiUrl } from '../../api.ts';

export default function Page() {

    const [tariffStructure, setTariffStructure] = useState<any[]>([]);

    useEffect(() => {
        fetch(apiUrl('/tariff/configuration')).then(r => r.json()).then(data => { setTariffStructure(data); });
    }, []);

    const updateTariff = async (sender: any) => {
        console.log(sender.target.dataset.index);

        tariffStructure[sender.target.dataset.index].price = tariffStructure[sender.target.dataset.index].price == 7.5 ? 28 : 7.5;
        setTariffStructure([...tariffStructure]);

        fetch(`${apiUrl()}/tariff/configuration?id=${sender.target.dataset.index}`, { method: "POST" });
    }

    const rows = tariffStructure.map((tariff: any, index: number) => {
        return <tr key={index}>
            <td>{tariff.hour}</td><td>{tariff.startMinute}</td><td>{tariff.endMinute}</td><td><input data-index={index} type="checkbox" onChange={updateTariff} checked={tariff.price === 7.5} /></td>
        </tr>
    });

    return <Container>
        <div>
            <h1>Tariff Configuration</h1>
            <hr />
            <table className="table bordered table-striped table-hover">
                <thead>
                    <tr>
                        <th>Hour</th>
                        <th>Start Minute</th>
                        <th>End Minute</th>
                        <th>Off-Peak</th>
                    </tr>
                </thead>
                <tbody>
                    {rows}
                </tbody>
            </table>
        </div>
    </Container>;
}